import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type CompactionRow,
	planCompaction,
	roleOf,
} from "./compaction.ts";

function row(
	partial: Partial<CompactionRow> & Pick<CompactionRow, "toolCallId" | "toolName">,
): CompactionRow {
	return {
		quiet: true,
		status: "settled",
		outcomeKind: "success",
		...partial,
	};
}

describe("planCompaction", () => {
	it("leaves singletons alone", () => {
		const rows = [row({ toolCallId: "a", toolName: "read" })];
		const plan = planCompaction(rows);
		assert.deepEqual(roleOf(plan, "a"), {
			role: "singleton",
			groupId: "a",
			carrierId: "a",
			memberIds: ["a"],
		});
	});

	it("groups two adjacent same-kind successes; last is carrier", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read", chip: "1 line" }),
			row({ toolCallId: "b", toolName: "read", chip: "2 lines" }),
		];
		const plan = planCompaction(rows);
		assert.deepEqual(roleOf(plan, "a"), {
			role: "hidden",
			groupId: "b",
			carrierId: "b",
			memberIds: ["a", "b"],
		});
		assert.deepEqual(roleOf(plan, "b"), {
			role: "carrier",
			groupId: "b",
			carrierId: "b",
			memberIds: ["a", "b"],
		});
	});

	it("allows Soft Breakthrough inside a group", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "grep", outcomeKind: "success", chip: "2 matches" }),
			row({ toolCallId: "b", toolName: "grep", outcomeKind: "soft", chip: "0 matches" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "carrier");
		assert.deepEqual(roleOf(plan, "b").memberIds, ["a", "b"]);
	});

	it("Hard Breakthrough never joins and splits neighbors", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read", outcomeKind: "hard", chip: "failed" }),
			row({ toolCallId: "c", toolName: "read" }),
			row({ toolCallId: "d", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "singleton");
		assert.equal(roleOf(plan, "b").role, "singleton");
		assert.equal(roleOf(plan, "c").role, "hidden");
		assert.equal(roleOf(plan, "d").role, "carrier");
		assert.deepEqual(roleOf(plan, "d").memberIds, ["c", "d"]);
	});

	it("different kinds do not group", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "grep" }),
			row({ toolCallId: "c", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "singleton");
		assert.equal(roleOf(plan, "b").role, "singleton");
		assert.equal(roleOf(plan, "c").role, "singleton");
	});

	it("pending blocks compaction until settled", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({
				toolCallId: "b",
				toolName: "read",
				status: "pending",
				outcomeKind: undefined,
			}),
			row({ toolCallId: "c", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "singleton");
		assert.equal(roleOf(plan, "b").role, "singleton");
		assert.equal(roleOf(plan, "c").role, "singleton");
	});

	it("does not fold a settled prefix while a same-kind neighbor is still pending", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({
				toolCallId: "c",
				toolName: "read",
				status: "pending",
				outcomeKind: undefined,
			}),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "singleton");
		assert.equal(roleOf(plan, "b").role, "singleton");
		assert.equal(roleOf(plan, "c").role, "singleton");
	});

	it("splitter rows break adjacency (assistant/user prose)", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			{ toolCallId: "split-1", toolName: "", quiet: false, status: "settled", splitter: true },
			row({ toolCallId: "c", toolName: "read" }),
			row({ toolCallId: "d", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		assert.deepEqual(roleOf(plan, "b").memberIds, ["a", "b"]);
		assert.deepEqual(roleOf(plan, "d").memberIds, ["c", "d"]);
	});

	it("non-quiet tools break adjacency", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "mcp", toolName: "mcp__x", quiet: false, outcomeKind: "success" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({ toolCallId: "c", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "singleton");
		assert.equal(roleOf(plan, "mcp").role, "singleton");
		assert.deepEqual(roleOf(plan, "c").memberIds, ["b", "c"]);
	});

	it("groups all seven quiet kinds the same way", () => {
		for (const toolName of ["read", "bash", "edit", "write", "find", "grep", "ls"] as const) {
			const rows = [
				row({ toolCallId: `${toolName}-1`, toolName }),
				row({ toolCallId: `${toolName}-2`, toolName }),
				row({ toolCallId: `${toolName}-3`, toolName }),
			];
			const plan = planCompaction(rows);
			assert.equal(roleOf(plan, `${toolName}-1`).role, "hidden");
			assert.equal(roleOf(plan, `${toolName}-2`).role, "hidden");
			assert.deepEqual(roleOf(plan, `${toolName}-3`), {
				role: "carrier",
				groupId: `${toolName}-3`,
				carrierId: `${toolName}-3`,
				memberIds: [`${toolName}-1`, `${toolName}-2`, `${toolName}-3`],
			});
		}
	});
});
