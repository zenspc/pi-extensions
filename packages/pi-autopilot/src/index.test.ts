import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import { atomicJson, Store } from "./state.ts";
import { models } from "./test-support.ts";

test("extension command/event contract: explicit activation, Escape protection, continuation, quota pause, and shutdown", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "autopilot-extension-")));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-q"); git("config", "user.name", "Dhairya"); git("config", "user.email", "autopilot-tests@example.invalid");
	git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture");
	const store = new Store(root); atomicJson(join(store.dir, "models.json"), models);
	const commands = new Map<string, any>(), events = new Map<string, any>(), registered = new Map<string, any>();
	const messages: string[] = [], entries: unknown[] = [], notices: string[] = [];
	let activeTools = ["read", "bash", "edit", "write"], listener: ((data: string) => any) | undefined;
	let removed = false;
	const api = {
		registerCommand: (name: string, value: unknown) => commands.set(name, value),
		registerTool: (value: any) => registered.set(value.name, value),
		on: (name: string, value: unknown) => events.set(name, value),
		getActiveTools: () => activeTools,
		setActiveTools: (value: string[]) => { activeTools = value; },
		sendUserMessage: (text: string) => messages.push(text),
		appendEntry: (_name: string, entry: unknown) => entries.push(entry),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: root, mode: "tui", hasUI: true, isIdle: () => true,
		ui: { setStatus: () => {}, notify: (value: string) => notices.push(value), onTerminalInput: (handler: typeof listener) => {
			listener = handler; return () => { removed = true; listener = undefined; };
		} },
	} as unknown as ExtensionContext;
	try {
		extension(api);
		assert.deepEqual([...commands.keys()].sort(), ["autopilot", "autopilot-models", "autopilot-pause", "autopilot-resume", "autopilot-status", "autopilot-stop"].sort());
		assert.equal(registered.size, 3);
		for (const tool of registered.values()) { assert.equal(tool.defaultActive, false); assert.equal(tool.executionMode, "sequential"); }
		assert.equal(listener, undefined, "factory must not start session resources");
		await commands.get("autopilot").handler("Implement the fixture goal", ctx);
		assert.deepEqual(activeTools, ["run_scouts", "save_or_update_plan", "dispatch_subagents"]);
		assert.equal(messages.length, 1);
		assert.deepEqual(listener!("\x1b"), { consume: true });
		assert.deepEqual(listener!("\x1b[27u"), { consume: true });
		assert.equal(listener!("x"), undefined);
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		events.get("before_agent_start")(event, ctx);
		assert.match(event.systemPromptOptions.sections.autopilot, /Lead Project Manager/);
		assert.match(event.systemPromptOptions.sections.autopilot, /cheap\/fast/);
		assert.equal(events.get("tool_call")({ toolName: "bash" }).block, true);
		assert.equal(events.get("tool_call")({ toolName: "dispatch_subagents" }), undefined);
		await events.get("agent_end")({ messages: [] }, ctx);
		assert.equal(messages.length, 2, "agent_end must queue an autonomous follow-up");
		await events.get("agent_end")({ messages: [] }, ctx);
		assert.equal(messages.length, 2, "do not duplicate queued continuations");
		events.get("before_agent_start")(event, ctx);
		await events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 quota exhausted" }] }, ctx);
		assert.equal(store.load()!.status, "paused_quota");
		assert.deepEqual(activeTools, ["read", "bash", "edit", "write"]);
		assert.equal(listener!("\x1b"), undefined);
		assert.ok(entries.length > 0);
		await commands.get("autopilot-status").handler("", ctx);
		assert.ok(notices.some((value) => value.includes("Scouted")));
		await commands.get("autopilot-resume").handler("--auto-wait", ctx);
		assert.equal(store.load()!.autoWait, true);
		await commands.get("autopilot-pause").handler("", ctx);
		assert.equal(store.load()!.status, "paused");
		await commands.get("autopilot-stop").handler("", ctx);
		assert.equal(store.load()!.status, "stopped");
		await events.get("session_shutdown")();
		assert.equal(removed, true);
	} finally {
		await events.get("session_shutdown")?.();
		rmSync(root, { recursive: true, force: true });
	}
});
