import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	HARD_FAILURE_TAIL_LINES,
	KIND_EMOJI,
	MAX_COMMAND_DISPLAY,
	basenameTarget,
	capFailureTail,
	displayTargets,
	formatCallSummary,
	formatGroupHeader,
	formatMemberBullet,
	formatMemberSummary,
	formatQuietResultLines,
	formatSingletonCallLine,
	kindEmoji,
	nounForKind,
	shortenPath,
	verbForKind,
	verbForTool,
} from "./format.ts";

describe("shortenPath / basenameTarget / displayTargets", () => {
	it("replaces home prefix with ~", () => {
		assert.equal(shortenPath("/home/u/proj/a.ts", "/home/u"), "~/proj/a.ts");
		assert.equal(shortenPath("/other/a.ts", "/home/u"), "/other/a.ts");
	});

	it("basename is last segment", () => {
		assert.equal(basenameTarget("/home/u/proj/main.rs"), "main.rs");
		assert.equal(basenameTarget("main.rs"), "main.rs");
		assert.equal(basenameTarget("."), ".");
	});

	it("disambiguates colliding basenames inside a group", () => {
		const paths = ["/repo/src/index.ts", "/repo/lib/index.ts", "/repo/src/util.ts"];
		assert.deepEqual(displayTargets(paths, "/home/u"), [
			"src/index.ts",
			"lib/index.ts",
			"util.ts",
		]);
	});
});

describe("verbs", () => {
	it("present while running, past when settled", () => {
		assert.equal(verbForTool("read", true), "Reading");
		assert.equal(verbForTool("read", false), "Read");
		assert.equal(verbForTool("write", true), "Writing");
		assert.equal(verbForTool("write", false), "Wrote");
		assert.equal(verbForTool("mcp", true), "Calling");
		assert.equal(verbForTool("mcp", false), "Called");
		assert.equal(verbForKind("file", false), "Read");
		assert.equal(verbForKind("search", true), "Searching");
		assert.equal(nounForKind("file", 3), "files");
		assert.equal(nounForKind("other", 1), "tool");
	});
});

describe("formatCallSummary", () => {
	it("formats built-in tool calls verb-first with basename", () => {
		assert.equal(
			formatCallSummary("read", { path: "/home/u/a.ts", offset: 10, limit: 5 }, "/home/u"),
			"Read a.ts (10-14)",
		);
		assert.equal(
			formatCallSummary("read", { path: "/home/u/a.ts" }, "/home/u", { running: true }),
			"Reading a.ts",
		);
		assert.equal(
			formatCallSummary("edit", { path: "/home/u/a.ts" }, "/home/u"),
			"Edited a.ts",
		);
		assert.equal(
			formatCallSummary("write", { path: "/home/u/a.ts", content: "a\nb" }, "/home/u"),
			"Wrote a.ts",
		);
		assert.equal(
			formatCallSummary("grep", { pattern: "TODO", path: "/home/u/src" }, "/home/u"),
			'Searched "TODO"',
		);
		assert.equal(
			formatCallSummary("find", { pattern: "*.ts", path: "." }, "/home/u"),
			"Searched *.ts",
		);
		assert.equal(formatCallSummary("ls", { path: "/home/u/src" }, "/home/u"), "Listed src");
	});

	it("truncates long bash commands with $ prompt", () => {
		const long = "x".repeat(MAX_COMMAND_DISPLAY + 20);
		const line = formatCallSummary("bash", { command: long }, "/home/u");
		assert.ok(line.startsWith("$ "));
		assert.ok(line.length <= 2 + MAX_COMMAND_DISPLAY);
		assert.ok(line.endsWith("..."));
	});
});

describe("capFailureTail", () => {
	it("keeps the last N lines", () => {
		const text = Array.from({ length: HARD_FAILURE_TAIL_LINES + 5 }, (_, i) => `L${i}`).join("\n");
		const tail = capFailureTail(text);
		const lines = tail.split("\n");
		assert.equal(lines.length, HARD_FAILURE_TAIL_LINES);
		assert.equal(lines[0], `L5`);
		assert.equal(lines.at(-1), `L${HARD_FAILURE_TAIL_LINES + 4}`);
	});
});

describe("formatQuietResultLines", () => {
	it("pending adds no extra lines (chip lives on the call line)", () => {
		assert.deepEqual(formatQuietResultLines({ kind: "pending" }, false), []);
	});

	it("success/soft collapsed add no extra lines", () => {
		assert.deepEqual(formatQuietResultLines({ kind: "success", chip: "3 lines" }, false), []);
		assert.deepEqual(formatQuietResultLines({ kind: "soft", chip: "no matches" }, false), []);
	});

	it("hard expanded adds capped tail only", () => {
		const body = Array.from({ length: 20 }, (_, i) => `err${i}`).join("\n");
		const collapsed = formatQuietResultLines({ kind: "hard", chip: "failed", body }, false);
		assert.deepEqual(collapsed, []);

		const expanded = formatQuietResultLines({ kind: "hard", chip: "failed", body }, true);
		assert.ok(expanded.length > 0);
		assert.ok(expanded.length <= HARD_FAILURE_TAIL_LINES);
		assert.equal(expanded.at(-1), "err19");
	});
});

describe("Kind Emoji", () => {
	it("maps all seven quiet tools", () => {
		assert.equal(kindEmoji("read"), "📖");
		assert.equal(kindEmoji("bash"), "💻");
		assert.equal(kindEmoji("edit"), "✏️");
		assert.equal(kindEmoji("write"), "📝");
		assert.equal(kindEmoji("grep"), "🔍");
		assert.equal(kindEmoji("find"), "🔎");
		assert.equal(kindEmoji("ls"), "📂");
		assert.equal(KIND_EMOJI.read, "📖");
	});

	it("Foreign Tools share the puzzle-piece Kind Emoji", () => {
		assert.equal(kindEmoji("mcp"), "🧩");
		assert.equal(kindEmoji("mcp__x"), "🧩");
		assert.equal(kindEmoji("subagent"), "🧩");
	});
});

describe("Generic Kind Formatter (Foreign Tools)", () => {
	it("priority keys win over later string fields", () => {
		assert.equal(
			formatCallSummary(
				"mcp",
				{ noise: "ignore", tool: "search", path: "/tmp" },
				"/home/u",
			),
			"Called mcp search",
		);
		assert.equal(
			formatCallSummary("codebase_memory_search_graph", { query: "Quiet Row" }, "/home/u"),
			"Called codebase_memory_search_graph Quiet Row",
		);
	});

	it("falls back to first safe stringish top-level value", () => {
		assert.equal(
			formatCallSummary("mcp", { limit: 10, target: "repo-a" }, "/home/u"),
			"Called mcp repo-a",
		);
		assert.equal(formatCallSummary("flag", { enabled: true }, "/home/u"), "Called flag true");
	});

	it("shortens path-like peeks and skips secret-ish keys", () => {
		assert.equal(
			formatCallSummary("readish", { path: "/home/u/src/a.ts" }, "/home/u"),
			"Called readish ~/src/a.ts",
		);
		assert.equal(
			formatCallSummary(
				"auth",
				{ token: "sekrit", password: "x", api_key: "k", note: "ok-value" },
				"/home/u",
			),
			"Called auth ok-value",
		);
	});

	it("name only when args empty or only secrets/objects", () => {
		assert.equal(formatCallSummary("mcp", {}, "/home/u"), "Called mcp");
		assert.equal(
			formatCallSummary("mcp", { token: "x", nested: { a: 1 } }, "/home/u"),
			"Called mcp",
		);
	});

	it("singleton / header / member use Foreign chrome", () => {
		assert.equal(
			formatSingletonCallLine("mcp", { tool: "search" }, "/home/u"),
			"🧩 Called mcp search",
		);
		assert.equal(formatGroupHeader("other", 3), "🧩 Called 3 tools");
		assert.equal(formatMemberSummary("mcp", { tool: "search" }, "/home/u"), "mcp search");
		assert.equal(formatMemberSummary("mcp", {}, "/home/u"), "mcp");
	});
});

describe("singleton / group chrome", () => {
	it("singleton call line prefixes Kind Emoji and parenthetical chip", () => {
		assert.equal(
			formatSingletonCallLine("read", { path: "/home/u/a.ts" }, "/home/u", {
				chip: "40 lines",
			}),
			"📖 Read a.ts (40 lines)",
		);
		// Range already in the summary; do not stack a line-count chip.
		assert.equal(
			formatSingletonCallLine(
				"read",
				{ path: "/home/u/a.ts", offset: 10, limit: 5 },
				"/home/u",
				{ chip: "5 lines" },
			),
			"📖 Read a.ts (10-14)",
		);
		// Hard still chips on ranged reads.
		assert.equal(
			formatSingletonCallLine(
				"read",
				{ path: "/home/u/a.ts", offset: 1, limit: 3 },
				"/home/u",
				{ chip: "failed" },
			),
			"📖 Read a.ts (1-3) (failed)",
		);
		assert.equal(
			formatSingletonCallLine("bash", { command: "ls -la" }, "/home/u"),
			"💻 $ ls -la",
		);
		assert.equal(
			formatSingletonCallLine("bash", { command: "false" }, "/home/u", { chip: "exit 1" }),
			"💻 $ false (exit 1)",
		);
		assert.equal(
			formatSingletonCallLine("read", { path: "/home/u/a.ts" }, "/home/u", { running: true }),
			"📖 Reading a.ts",
		);
	});

	it("Group Header is emoji + verb + count + noun", () => {
		assert.equal(formatGroupHeader("file", 4), "📖 Read 4 files");
		assert.equal(formatGroupHeader("search", 2), "🔍 Searched 2 patterns");
		assert.equal(formatGroupHeader("dir", 1), "📂 Listed 1 dir");
	});

	it("Member Summary strips the verb", () => {
		assert.equal(
			formatMemberSummary("read", { path: "/home/u/a.ts", offset: 10, limit: 5 }, "/home/u"),
			"a.ts (10-14)",
		);
		assert.equal(formatMemberSummary("edit", { path: "/home/u/a.ts" }, "/home/u"), "a.ts");
		assert.equal(formatMemberSummary("bash", { command: "echo hi" }, "/home/u"), "$ echo hi");
		assert.equal(
			formatMemberSummary("grep", { pattern: "TODO", path: "/home/u/src" }, "/home/u"),
			'"TODO"',
		);
		assert.equal(
			formatMemberSummary("find", { pattern: "*.ts", path: "." }, "/home/u"),
			"*.ts",
		);
		assert.equal(formatMemberSummary("ls", { path: "/home/u/src" }, "/home/u"), "src");
		assert.equal(
			formatMemberSummary("write", { path: "/home/u/a.ts" }, "/home/u"),
			"a.ts",
		);
	});

	it("Member Bullet is bullet + summary + parenthetical chip", () => {
		assert.equal(formatMemberBullet("a.ts", "12 lines"), "  • a.ts (12 lines)");
		assert.equal(formatMemberBullet("$ echo hi", undefined), "  • $ echo hi");
		assert.equal(formatMemberBullet("a.ts", undefined), "  • a.ts");
	});
});
