import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCompaction, roleOf } from "./compaction.ts";
import { messagesFromBranch, rowsFromMessages } from "./history.ts";

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
});
