import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { browserTool } from "./browser-tool.ts";
import { installDomainGate } from "./gate.ts";
import extension from "./index.ts";

type Handler = (
	event: ToolCallEvent,
	ctx: ExtensionContext
) => Promise<ToolCallEventResult | undefined>;
function host() {
	const handlers = new Map<string, Function>();
	const tools = new Map<string, any>();
	const pi = {
		on: (name: string, fn: Function) => handlers.set(name, fn),
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand() {},
	} as unknown as ExtensionAPI;
	return {
		pi,
		handlers,
		tools,
		call: (input: Record<string, unknown>, ctx: ExtensionContext) =>
			(handlers.get("tool_call") as Handler)(
				{
					type: "tool_call",
					toolName: "browser_snapshot",
					input,
					toolCallId: "test",
				} as ToolCallEvent,
				ctx
			),
	};
}

function register(pi: ExtensionAPI, url: string) {
	browserTool(pi, {
		name: "browser_snapshot",
		label: "Snapshot",
		description: "test",
		parameters: Type.Object({}),
		urlFrom: async () => url,
		async execute() {
			return { content: [], details: undefined };
		},
	});
}

it("isolates URL extractors and approval state between extension instances", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-runtime-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const first = host();
	const second = host();
	const a = installDomainGate(first.pi, { allowlistPath: join(dir, "a.json") });
	const b = installDomainGate(second.pi, { allowlistPath: join(dir, "b.json") });
	register(first.pi, "https://first.test/");
	register(second.pi, "https://second.test/");
	a.allowed.add("first.test");
	const ctx = { hasUI: false } as ExtensionContext;
	assert.equal(await first.call({}, ctx), undefined);
	assert.match((await second.call({}, ctx))?.reason ?? "", /second.test/);
	assert.equal(b.allowed.has("first.test"), false);
});

it("serializes approvals and coalesces concurrent calls to the same domain", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-prompts-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const app = host();
	installDomainGate(app.pi, { allowlistPath: join(dir, "allow.json") });
	register(app.pi, "https://example.com/");
	let prompts = 0;
	const ctx = {
		hasUI: true,
		ui: {
			select: async () => {
				prompts++;
				return "Approve once";
			},
		},
	} as unknown as ExtensionContext;
	assert.deepEqual(await Promise.all([app.call({}, ctx), app.call({}, ctx)]), [
		undefined,
		undefined,
	]);
	assert.equal(prompts, 1);
});

it("does not grant or deny a domain when a prompt is cancelled by the operation", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-prompt-abort-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const app = host();
	const gate = installDomainGate(app.pi, { allowlistPath: join(dir, "allow.json") });
	register(app.pi, "https://example.com/");
	const controller = new AbortController();
	const ctx = {
		hasUI: true,
		signal: controller.signal,
		ui: {
			select: async () => {
				controller.abort();
				return "Approve once";
			},
		},
	} as unknown as ExtensionContext;
	assert.equal((await app.call({}, ctx))?.block, true);
	assert.equal(gate.allowed.has("example.com"), false);
	assert.equal(
		await app.call({}, {
			hasUI: true,
			ui: { select: async () => "Approve once" },
		} as unknown as ExtensionContext),
		undefined
	);
});

it("registers sequential tools and disconnects its Attachment at shutdown", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-shutdown-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const app = host();
	let closed = 0;
	extension(app.pi, {
		allowlistPath: join(dir, "allow.json"),
		availabilityPath: join(dir, "available.json"),
		attachment: {
			withTab: async () => {
				throw new Error("Unexpected attachment during registration");
			},
			close: async () => {
				closed++;
			},
			isAttached: false,
		},
	});
	assert.equal(app.tools.size, 6);
	for (const tool of app.tools.values()) {
		assert.equal(tool.executionMode, "sequential");
		assert.equal("urlFrom" in tool, false);
	}
	await app.handlers.get("session_shutdown")!();
	assert.equal(closed, 1);
});
