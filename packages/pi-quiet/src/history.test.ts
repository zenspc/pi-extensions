import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { planCompaction, roleOf } from "./compaction.ts";
import { messagesFromBranch, rowsFromMessages } from "./history.ts";
import { setForeignToolsQuiet } from "./tools-meta.ts";

afterEach(() => {
	setForeignToolsQuiet(false);
});

describe("rowsFromMessages", () => {
	it("rebuilds a Compaction Group across adjacent reads and splits on assistant prose", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "1", name: "read", arguments: { path: "/a.ts" } },
					{ type: "toolCall", id: "2", name: "read", arguments: { path: "/b.ts" } },
				],
			},
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "read",
				content: [{ type: "text", text: "line1\nline2" }],
				isError: false,
			},
			{
				role: "toolResult",
				toolCallId: "2",
				toolName: "read",
				content: [{ type: "text", text: "only" }],
				isError: false,
			},
			{ role: "assistant", content: [{ type: "text", text: "done reading" }] },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "3", name: "read", arguments: { path: "/c.ts" } }],
			},
			{
				role: "toolResult",
				toolCallId: "3",
				toolName: "read",
				content: [{ type: "text", text: "c" }],
				isError: false,
			},
		];

		const rows = rowsFromMessages(messages);
		const plan = planCompaction(rows);

		assert.equal(roleOf(plan, "1").role, "hidden");
		assert.equal(roleOf(plan, "2").role, "carrier");
		assert.deepEqual(roleOf(plan, "2").memberIds, ["1", "2"]);
		assert.equal(roleOf(plan, "3").role, "singleton");
	});

	it("messagesFromBranch keeps message payloads only", () => {
		const msgs = messagesFromBranch([
			{ type: "thinking_level_change" },
			{ type: "message", message: { role: "user", content: "hi" } },
			{ type: "message", message: { role: "assistant", content: [] } },
		]);
		assert.equal(msgs.length, 2);
	});

	it("retains result bodies only for quiet success|soft rows", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "ok", name: "read", arguments: { path: "/a" } },
					{ type: "toolCall", id: "hard", name: "read", arguments: { path: "/b" } },
					{ type: "toolCall", id: "mcp", name: "mcp__x", arguments: {} },
				],
			},
			{
				role: "toolResult",
				toolCallId: "ok",
				toolName: "read",
				content: [{ type: "text", text: "hello" }],
				isError: false,
			},
			{
				role: "toolResult",
				toolCallId: "hard",
				toolName: "read",
				content: [{ type: "text", text: "Error: nope" }],
				isError: true,
			},
			{
				role: "toolResult",
				toolCallId: "mcp",
				toolName: "mcp__x",
				content: [{ type: "text", text: "payload" }],
				isError: false,
			},
		];

		const rows = rowsFromMessages(messages);
		const byId = new Map(rows.filter((r) => !r.splitter).map((r) => [r.toolCallId, r]));

		assert.equal(byId.get("ok")?.outcomeKind, "success");
		assert.ok(byId.get("ok")?.result?.content?.length);

		assert.equal(byId.get("hard")?.outcomeKind, "hard");
		assert.equal(byId.get("hard")?.result, undefined);

		assert.equal(byId.get("mcp")?.quiet, false);
		assert.equal(byId.get("mcp")?.result, undefined);
	});

	it("Foreign Tools rebuild as quiet with retained bodies when enabled", () => {
		setForeignToolsQuiet(true);
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "m1", name: "mcp", arguments: { tool: "search" } },
					{ type: "toolCall", id: "m2", name: "mcp", arguments: { tool: "list" } },
				],
			},
			{
				role: "toolResult",
				toolCallId: "m1",
				toolName: "mcp",
				content: [{ type: "text", text: "one" }],
				isError: false,
			},
			{
				role: "toolResult",
				toolCallId: "m2",
				toolName: "mcp",
				content: [{ type: "text", text: "two" }],
				isError: false,
			},
		];

		const rows = rowsFromMessages(messages);
		const byId = new Map(rows.filter((r) => !r.splitter).map((r) => [r.toolCallId, r]));
		assert.equal(byId.get("m1")?.quiet, true);
		assert.equal(byId.get("m1")?.chip, "ok");
		assert.ok(byId.get("m1")?.result?.content?.length);
		assert.equal(byId.get("m2")?.quiet, true);

		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "m1").role, "hidden");
		assert.equal(roleOf(plan, "m2").role, "carrier");
	});
});
