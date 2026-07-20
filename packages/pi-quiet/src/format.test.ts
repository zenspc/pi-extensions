import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	HARD_FAILURE_TAIL_LINES,
	KIND_EMOJI,
	MAX_COMMAND_DISPLAY,
	capFailureTail,
	formatCallSummary,
	formatGroupHeader,
	formatMemberBullet,
	formatMemberSummary,
	formatQuietResultLines,
	formatSingletonCallLine,
	kindEmoji,
	shortenPath,
} from "./format.ts";

describe("shortenPath", () => {
	it("replaces home prefix with ~", () => {
		assert.equal(shortenPath("/home/u/proj/a.ts", "/home/u"), "~/proj/a.ts");
		assert.equal(shortenPath("/other/a.ts", "/home/u"), "/other/a.ts");
	});
});

describe("formatCallSummary", () => {
	it("formats built-in tool calls", () => {
		assert.equal(
			formatCallSummary("read", { path: "/home/u/a.ts", offset: 10, limit: 5 }, "/home/u"),
			"read ~/a.ts:10-14",
		);
		assert.equal(
			formatCallSummary("edit", { path: "/home/u/a.ts" }, "/home/u"),
			"edit ~/a.ts",
		);
		assert.equal(
			formatCallSummary("write", { path: "/home/u/a.ts", content: "a\nb" }, "/home/u"),
			"write ~/a.ts",
		);
		assert.equal(
			formatCallSummary("grep", { pattern: "TODO", path: "/home/u/src" }, "/home/u"),
			"grep /TODO/ in ~/src",
		);
		assert.equal(
			formatCallSummary("find", { pattern: "*.ts", path: "." }, "/home/u"),
			"find *.ts in .",
		);
		assert.equal(formatCallSummary("ls", { path: "/home/u" }, "/home/u"), "ls ~");
	});

	it("truncates long bash commands", () => {
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
	it("pending is a single marker", () => {
		assert.deepEqual(formatQuietResultLines({ kind: "pending" }, false), ["…"]);
	});

	it("success collapsed is chip only", () => {
		assert.deepEqual(formatQuietResultLines({ kind: "success", chip: "3 lines" }, false), [
			"· 3 lines",
		]);
	});

	it("soft collapsed stays compact", () => {
		assert.deepEqual(formatQuietResultLines({ kind: "soft", chip: "0 matches" }, false), [
			"· 0 matches",
		]);
	});

	it("hard collapsed still exposes chip; expanded adds capped tail", () => {
		const body = Array.from({ length: 20 }, (_, i) => `err${i}`).join("\n");
		const collapsed = formatQuietResultLines(
			{ kind: "hard", chip: "failed", body },
			false,
		);
		assert.deepEqual(collapsed, ["· failed"]);

		const expanded = formatQuietResultLines(
			{ kind: "hard", chip: "failed", body },
			true,
		);
		assert.equal(expanded[0], "· failed");
		assert.ok(expanded.length > 1);
		assert.ok(expanded.length <= 1 + HARD_FAILURE_TAIL_LINES);
	});

	it("success expanded signals full body should be used by renderer", () => {
		// Formatter stays chip-only; expand body is stock (renderer concern).
		assert.deepEqual(formatQuietResultLines({ kind: "success", chip: "exit 0" }, true), [
			"· exit 0",
		]);
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

	it("unknown tools get an empty marker", () => {
		assert.equal(kindEmoji("mcp__x"), "");
	});
});

describe("singleton / group chrome", () => {
	it("singleton call line prefixes Kind Emoji", () => {
		assert.equal(
			formatSingletonCallLine("read", { path: "/home/u/a.ts" }, "/home/u"),
			"📖 read ~/a.ts",
		);
		assert.equal(
			formatSingletonCallLine("bash", { command: "ls -la" }, "/home/u"),
			"💻 $ ls -la",
		);
	});

	it("Group Header is emoji + kind ×N", () => {
		assert.equal(formatGroupHeader("read", 4), "📖 read ×4");
		assert.equal(formatGroupHeader("grep", 2), "🔍 grep ×2");
	});

	it("Member Summary strips the tool name", () => {
		assert.equal(
			formatMemberSummary("read", { path: "/home/u/a.ts", offset: 10, limit: 5 }, "/home/u"),
			"~/a.ts:10-14",
		);
		assert.equal(
			formatMemberSummary("edit", { path: "/home/u/a.ts" }, "/home/u"),
			"~/a.ts",
		);
		assert.equal(
			formatMemberSummary("bash", { command: "echo hi" }, "/home/u"),
			"$ echo hi",
		);
		assert.equal(
			formatMemberSummary("grep", { pattern: "TODO", path: "/home/u/src" }, "/home/u"),
			"/TODO/ in ~/src",
		);
		assert.equal(
			formatMemberSummary("find", { pattern: "*.ts", path: "." }, "/home/u"),
			"*.ts in .",
		);
		assert.equal(formatMemberSummary("ls", { path: "/home/u" }, "/home/u"), "~");
		assert.equal(
			formatMemberSummary("write", { path: "/home/u/a.ts" }, "/home/u"),
			"~/a.ts",
		);
	});

	it("Member Bullet is bullet + summary + chip", () => {
		assert.equal(
			formatMemberBullet("~/a.ts", "12 lines"),
			"  • ~/a.ts · 12 lines",
		);
		assert.equal(formatMemberBullet("$ echo hi", "exit 0"), "  • $ echo hi · exit 0");
		assert.equal(formatMemberBullet("~/a.ts", undefined), "  • ~/a.ts");
	});
});
