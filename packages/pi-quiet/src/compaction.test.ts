import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	CompactionIndex,
	type CompactionRow,
	planCompaction,
	roleOf,
} from "./compaction.ts";
import { setForeignToolsQuiet } from "./tools-meta.ts";

afterEach(() => {
	setForeignToolsQuiet(false);
});

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

describe("planCompaction (Verb Groups)", () => {
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

	it("groups two adjacent File successes; last is carrier", () => {
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

	it("groups grep and find together as Search", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "grep", chip: "2 matches" }),
			row({ toolCallId: "b", toolName: "find", chip: "3 files" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "carrier");
		assert.deepEqual(roleOf(plan, "b").memberIds, ["a", "b"]);
	});

	it("allows Soft Breakthrough inside a group", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "grep", outcomeKind: "success", chip: "2 matches" }),
			row({ toolCallId: "b", toolName: "grep", outcomeKind: "soft", chip: "no matches" }),
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

	it("different Verb Group Kinds do not group", () => {
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

	it("bash/edit/write never join Verb Groups", () => {
		for (const toolName of ["bash", "edit", "write"] as const) {
			const rows = [
				row({ toolCallId: `${toolName}-1`, toolName }),
				row({ toolCallId: `${toolName}-2`, toolName }),
				row({ toolCallId: `${toolName}-3`, toolName }),
			];
			const plan = planCompaction(rows);
			assert.equal(roleOf(plan, `${toolName}-1`).role, "singleton");
			assert.equal(roleOf(plan, `${toolName}-2`).role, "singleton");
			assert.equal(roleOf(plan, `${toolName}-3`).role, "singleton");
		}
	});

	it("pending in the middle splits neighbors and never joins", () => {
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

	it("keeps a settled same-kind group while a trailing same-kind tool is pending", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({ toolCallId: "c", toolName: "read" }),
			row({
				toolCallId: "d",
				toolName: "read",
				status: "pending",
				outcomeKind: undefined,
			}),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "hidden");
		assert.deepEqual(roleOf(plan, "c"), {
			role: "carrier",
			groupId: "c",
			carrierId: "c",
			memberIds: ["a", "b", "c"],
		});
		assert.equal(roleOf(plan, "d").role, "singleton");
		assert.deepEqual(roleOf(plan, "d").memberIds, ["d"]);
	});

	it("grows the group when the trailing pending settles success/soft", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({ toolCallId: "c", toolName: "read" }),
			row({ toolCallId: "d", toolName: "read", outcomeKind: "success", chip: "1 line" }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "hidden");
		assert.equal(roleOf(plan, "c").role, "hidden");
		assert.deepEqual(roleOf(plan, "d"), {
			role: "carrier",
			groupId: "d",
			carrierId: "d",
			memberIds: ["a", "b", "c", "d"],
		});
	});

	it("pending different kind leaves the settled read group intact", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({
				toolCallId: "c",
				toolName: "bash",
				status: "pending",
				outcomeKind: undefined,
			}),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.deepEqual(roleOf(plan, "b").memberIds, ["a", "b"]);
		assert.equal(roleOf(plan, "c").role, "singleton");
	});

	it("soft + success join; trailing pending stays singleton only", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "grep", outcomeKind: "success", chip: "2 matches" }),
			row({ toolCallId: "b", toolName: "grep", outcomeKind: "soft", chip: "no matches" }),
			row({
				toolCallId: "c",
				toolName: "grep",
				status: "pending",
				outcomeKind: undefined,
			}),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "carrier");
		assert.deepEqual(roleOf(plan, "b").memberIds, ["a", "b"]);
		assert.equal(roleOf(plan, "c").role, "singleton");
	});

	it("shares one memberIds array reference across a group", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "read" }),
			row({ toolCallId: "b", toolName: "read" }),
			row({ toolCallId: "c", toolName: "read" }),
		];
		const plan = planCompaction(rows);
		const a = roleOf(plan, "a");
		const b = roleOf(plan, "b");
		const c = roleOf(plan, "c");
		assert.equal(a.memberIds, b.memberIds);
		assert.equal(b.memberIds, c.memberIds);
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

	it("Foreign Tools group together as Other regardless of exact name", () => {
		const rows = [
			row({ toolCallId: "a", toolName: "mcp", chip: undefined }),
			row({ toolCallId: "b", toolName: "subagent", chip: undefined }),
			row({ toolCallId: "c", toolName: "other_tool", chip: undefined }),
		];
		const plan = planCompaction(rows);
		assert.equal(roleOf(plan, "a").role, "hidden");
		assert.equal(roleOf(plan, "b").role, "hidden");
		assert.deepEqual(roleOf(plan, "c").memberIds, ["a", "b", "c"]);
	});

	it("groups joinable explore kinds", () => {
		for (const toolName of ["read", "find", "grep", "ls"] as const) {
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

describe("CompactionIndex", () => {
	it("getRow returns the same object identity as getRows()", () => {
		const index = new CompactionIndex();
		index.onEnd({
			toolCallId: "a",
			toolName: "read",
			outcomeKind: "success",
			chip: "1 line",
			args: { path: "/a" },
			result: { content: [{ type: "text", text: "hi" }] },
		});
		const fromRows = index.getRows().find((r) => r.toolCallId === "a");
		assert.equal(index.getRow("a"), fromRows);
	});

	it("growing a same-kind run of 10 invalidates at most 30 times total", () => {
		const index = new CompactionIndex();
		let inv = 0;
		for (let i = 0; i < 10; i++) {
			const id = `t${i}`;
			index.registerInvalidate(id, () => {
				inv += 1;
			});
			index.onStart({ toolCallId: id, toolName: "read", args: { path: `f${i}` } });
			index.onEnd({
				toolCallId: id,
				toolName: "read",
				outcomeKind: "success",
				chip: "1 line",
				args: { path: `f${i}` },
				result: { content: [{ type: "text", text: "hi" }] },
			});
		}
		assert.ok(inv <= 30, `expected ≤30 invalidates, got ${inv}`);
	});

	it("does not invalidate hidden members that stay hidden when the group grows", () => {
		const index = new CompactionIndex();
		const counts = new Map<string, number>();
		const track = (id: string) => {
			counts.set(id, 0);
			index.registerInvalidate(id, () => {
				counts.set(id, (counts.get(id) ?? 0) + 1);
			});
		};

		for (const id of ["a", "b", "c"]) track(id);

		index.onStart({ toolCallId: "a", toolName: "read", args: { path: "/a" } });
		index.onEnd({
			toolCallId: "a",
			toolName: "read",
			outcomeKind: "success",
			chip: "1 line",
			args: { path: "/a" },
			result: { content: [{ type: "text", text: "a" }] },
		});
		index.onStart({ toolCallId: "b", toolName: "read", args: { path: "/b" } });
		index.onEnd({
			toolCallId: "b",
			toolName: "read",
			outcomeKind: "success",
			chip: "1 line",
			args: { path: "/b" },
			result: { content: [{ type: "text", text: "b" }] },
		});

		// a is hidden, b is carrier. Reset counters before growth.
		counts.set("a", 0);
		counts.set("b", 0);
		counts.set("c", 0);

		index.onStart({ toolCallId: "c", toolName: "read", args: { path: "/c" } });
		index.onEnd({
			toolCallId: "c",
			toolName: "read",
			outcomeKind: "success",
			chip: "1 line",
			args: { path: "/c" },
			result: { content: [{ type: "text", text: "c" }] },
		});

		assert.equal(counts.get("a"), 0, "hidden-staying-hidden must not invalidate");
		assert.ok((counts.get("b") ?? 0) >= 1, "old carrier must invalidate when demoted");
		assert.ok((counts.get("c") ?? 0) >= 1, "new carrier must invalidate");
	});

	it("retains result only for joinable quiet success|soft rows", () => {
		const index = new CompactionIndex();
		const body = { content: [{ type: "text", text: "boom" }], details: { x: 1 } };

		index.onEnd({
			toolCallId: "hard",
			toolName: "read",
			outcomeKind: "hard",
			chip: "failed",
			result: body,
			isError: true,
		});
		assert.equal(index.getRow("hard")?.result, undefined);

		// Foreign Tools stay non-participating until the renderer hook enables them.
		index.onEnd({
			toolCallId: "mcp",
			toolName: "mcp__x",
			outcomeKind: "success",
			result: body,
		});
		assert.equal(index.getRow("mcp")?.quiet, false);
		assert.equal(index.getRow("mcp")?.result, undefined);

		// bash is quiet but never joins - no retained body needed for groups.
		index.onEnd({
			toolCallId: "bash",
			toolName: "bash",
			outcomeKind: "success",
			result: body,
		});
		assert.equal(index.getRow("bash")?.result, undefined);

		index.onEnd({
			toolCallId: "ok",
			toolName: "read",
			outcomeKind: "success",
			chip: "1 line",
			result: body,
		});
		assert.deepEqual(index.getRow("ok")?.result, body);

		index.onEnd({
			toolCallId: "soft",
			toolName: "grep",
			outcomeKind: "soft",
			chip: "no matches",
			result: body,
		});
		assert.deepEqual(index.getRow("soft")?.result, body);
	});

	it("retains Foreign Tool success bodies when Foreign Quiet is enabled", () => {
		setForeignToolsQuiet(true);
		const index = new CompactionIndex();
		const body = { content: [{ type: "text", text: "payload" }] };

		index.onEnd({
			toolCallId: "mcp",
			toolName: "mcp",
			outcomeKind: "success",
			args: { tool: "search" },
			result: body,
		});
		assert.equal(index.getRow("mcp")?.quiet, true);
		assert.deepEqual(index.getRow("mcp")?.result, body);

		index.onStart({ toolCallId: "m2", toolName: "subagent", args: { tool: "list" } });
		index.onEnd({
			toolCallId: "m2",
			toolName: "subagent",
			outcomeKind: "success",
			args: { tool: "list" },
			result: body,
		});
		// Different Foreign names still fold as Other.
		assert.equal(index.role("mcp").role, "hidden");
		assert.equal(index.role("m2").role, "carrier");
		assert.deepEqual(index.role("m2").memberIds, ["mcp", "m2"]);
	});
});
