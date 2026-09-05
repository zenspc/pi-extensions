import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatSpinnerHelp,
	formatSpinnerStatus,
	getSpinnerArgumentCompletions,
	parseSpinnerCommand,
} from "./command.ts";
import { defaults } from "./config.ts";

describe("parseSpinnerCommand", () => {
	it("treats empty args as the TUI menu", () => {
		assert.deepEqual(parseSpinnerCommand(""), { action: "menu" });
		assert.deepEqual(parseSpinnerCommand("   "), { action: "menu" });
	});

	it("parses the slash-arg table", () => {
		assert.deepEqual(parseSpinnerCommand("help"), { action: "help" });
		assert.deepEqual(parseSpinnerCommand("status"), { action: "status" });
		assert.deepEqual(parseSpinnerCommand("rotate"), { action: "rotate" });
		assert.deepEqual(parseSpinnerCommand("reset"), { action: "reset", target: "all" });
		assert.deepEqual(parseSpinnerCommand("reset global"), { action: "reset", target: "global" });
		assert.deepEqual(parseSpinnerCommand("reset project"), { action: "reset", target: "project" });
		assert.deepEqual(parseSpinnerCommand("pack calm"), { action: "pack", name: "calm" });
		assert.deepEqual(parseSpinnerCommand("pack dry"), { action: "pack", name: "dry" });
		assert.deepEqual(parseSpinnerCommand("pack default"), { action: "pack", name: "default" });
		assert.deepEqual(parseSpinnerCommand("random"), { action: "cycleMode", mode: "random" });
		assert.deepEqual(parseSpinnerCommand("sequential"), { action: "cycleMode", mode: "sequential" });
		assert.deepEqual(parseSpinnerCommand("dots"), { action: "preset", name: "dots" });
		assert.deepEqual(parseSpinnerCommand("hidden"), { action: "preset", name: "hidden" });
		assert.deepEqual(parseSpinnerCommand("line"), { action: "preset", name: "line" });
	});

	it("lowercases known preset names", () => {
		assert.deepEqual(parseSpinnerCommand("DOTS"), { action: "preset", name: "dots" });
	});

	it("rejects unknown tokens and extra words", () => {
		assert.deepEqual(parseSpinnerCommand("pack nope"), {
			action: "unknown",
			token: "pack nope",
		});
		assert.deepEqual(parseSpinnerCommand("braille extra"), {
			action: "unknown",
			token: "braille extra",
		});
	});
});

describe("formatSpinnerHelp / formatSpinnerStatus", () => {
	it("lists slash-arg usage and both config paths", () => {
		const help = formatSpinnerHelp({
			global: "/g/spinner.json",
			project: "/p/spinner.json",
		});
		assert.match(help, /\/spinner/);
		assert.match(help, /status/);
		assert.match(help, /help/);
		assert.match(help, /rotate/);
		assert.match(help, /reset/);
		assert.match(help, /pack/);
		assert.match(help, /random/);
		assert.match(help, /sequential/);
		assert.match(help, /\/g\/spinner\.json/);
		assert.match(help, /\/p\/spinner\.json/);
		assert.equal(help.includes("\u001b"), false);
	});

	it("reports merged config fields and both paths", () => {
		const cfg = {
			...defaults(),
			preset: "dots",
			customFrames: ["x", "y"],
			messages: ["a", "b", "c"],
			messagePack: "calm" as const,
			cycleMode: "sequential" as const,
			cycleIntervalMs: 3000,
			customized: true,
		};
		const status = formatSpinnerStatus(cfg, {
			global: "/g/spinner.json",
			project: "/p/spinner.json",
		});
		assert.match(status, /dots/);
		assert.match(status, /Custom frames: 2/);
		assert.match(status, /Messages: 3/);
		assert.match(status, /calm/);
		assert.match(status, /sequential/);
		assert.match(status, /3000/);
		assert.match(status, /yes/);
		assert.match(status, /\/g\/spinner\.json/);
		assert.match(status, /\/p\/spinner\.json/);
		assert.equal(status.includes("\u001b"), false);
	});
});

describe("getSpinnerArgumentCompletions", () => {
	it("includes status and hidden for an empty prefix", () => {
		const values = getSpinnerArgumentCompletions("")?.map((item) => item.value) ?? [];
		assert.ok(values.includes("status"));
		assert.ok(values.includes("hidden"));
	});

	it("includes pack for a partial first token", () => {
		const values = getSpinnerArgumentCompletions("pa")?.map((item) => item.value) ?? [];
		assert.ok(values.includes("pack"));
	});

	it("includes full pack values after pack", () => {
		const values = getSpinnerArgumentCompletions("pack ")?.map((item) => item.value) ?? [];
		assert.ok(values.includes("pack calm"));
	});

	it("returns null when nothing matches", () => {
		assert.equal(getSpinnerArgumentCompletions("nope"), null);
	});
});
