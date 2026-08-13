import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MessageCycler } from "./cycler.ts";

function fakeCtx(sink: string[]) {
	return {
		mode: "tui",
		ui: {
			theme: { fg: (_k: string, t: string) => t },
			setWorkingMessage: (m?: string) => {
				if (m !== undefined) sink.push(m);
			},
		},
	} as unknown as ExtensionContext;
}

function startedCycler(
	sink: string[],
	opts: { messages: readonly string[]; cycleMode?: "random" | "sequential"; intervalMs?: number },
): MessageCycler {
	const cycler = new MessageCycler({
		messages: opts.messages,
		intervalMs: opts.intervalMs ?? 60_000,
		ctx: fakeCtx(sink),
		cycleMode: opts.cycleMode,
	});
	cycler.start();
	return cycler;
}

describe("MessageCycler random mode", () => {
	it("stays on the only message", () => {
		const sink: string[] = [];
		const cycler = startedCycler(sink, { messages: ["Only"] });
		cycler.tickNow();
		cycler.tickNow();
		assert.deepEqual(sink, ["Only", "Only", "Only"]);
		cycler.stop({ restoreDefault: false });
	});
});

describe("MessageCycler sequential mode", () => {
	it("walks messages in list order", () => {
		const sink: string[] = [];
		const cycler = startedCycler(sink, {
			messages: ["A", "B", "C"],
			cycleMode: "sequential",
		});
		cycler.tickNow();
		cycler.tickNow();
		assert.deepEqual(sink, ["A", "B", "C"]);
		cycler.stop({ restoreDefault: false });
	});

	it("wraps back to the start", () => {
		const sink: string[] = [];
		const cycler = startedCycler(sink, {
			messages: ["A", "B"],
			cycleMode: "sequential",
		});
		cycler.tickNow();
		cycler.tickNow();
		cycler.tickNow();
		assert.deepEqual(sink, ["A", "B", "A", "B"]);
		cycler.stop({ restoreDefault: false });
	});

	it("restarts at the first message after update", () => {
		const sink: string[] = [];
		const cycler = startedCycler(sink, {
			messages: ["A", "B", "C"],
			cycleMode: "sequential",
		});
		cycler.tickNow();
		cycler.update(["X", "Y"], 60_000);
		cycler.tickNow();
		assert.equal(sink.at(-1), "X");
		cycler.stop({ restoreDefault: false });
	});

	it("starts at the first message after stop then start", () => {
		const sink: string[] = [];
		const cycler = startedCycler(sink, {
			messages: ["A", "B", "C"],
			cycleMode: "sequential",
		});
		cycler.tickNow();
		cycler.stop({ restoreDefault: false });
		cycler.start();
		assert.equal(sink.at(-1), "A");
		cycler.stop({ restoreDefault: false });
	});
});
