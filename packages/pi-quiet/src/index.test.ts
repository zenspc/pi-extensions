import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import quietExtension from "./index.ts";

test("extension observes tools, rebuilds branch state, ignores nested calls and persists the existing preference", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-quiet-integration-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	try {
		const handlers = new Map<string, Function>();
		const commands = new Map<string, any>();
		let renderer: any;
		quietExtension({
			on: (event: string, handler: Function) =>
				handlers.set(event, handler),
			registerToolRenderer: (resolver: any) => {
				renderer = resolver;
			},
			registerCommand: (name: string, command: any) =>
				commands.set(name, command),
		} as any);
		assert.equal(typeof renderer, "function");
		const notices: string[] = [];
		const ctx: any = {
			mode: "rpc",
			hasUI: true,
			sessionManager: { getBranch: () => [] },
			ui: { notify: (text: string) => notices.push(text) },
		};
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("tool_execution_start")!(
			{ toolCallId: "a", toolName: "read", args: { path: "x" } },
			ctx
		);
		await handlers.get("tool_execution_end")!(
			{
				toolCallId: "a",
				toolName: "read",
				result: {
					content: [{ type: "text", text: "x" }],
					details: undefined,
				},
				isError: false,
			},
			ctx
		);
		await handlers.get("tool_execution_start")!(
			{
				toolCallId: "a/0",
				parentToolCallId: "a",
				toolName: "read",
				args: {},
			},
			ctx
		);
		await handlers.get("session_tree")!({}, ctx);
		await handlers.get("session_compact")!({}, ctx);
		await commands.get("quiet").handler("off", ctx);
		assert.deepEqual(
			JSON.parse(
				readFileSync(join(directory, "extensions/quiet.json"), "utf8")
			),
			{ enabled: false }
		);
		await commands.get("quiet").handler("on", ctx);
		assert.deepEqual(
			JSON.parse(
				readFileSync(join(directory, "extensions/quiet.json"), "utf8")
			),
			{ enabled: true }
		);
		await commands.get("quiet").handler("help", ctx);
		assert.match(notices.at(-1)!, /terminal chrome/);
		await handlers.get("session_shutdown")!({}, ctx);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});
