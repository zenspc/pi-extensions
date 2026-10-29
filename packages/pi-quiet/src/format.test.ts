import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compactLocation,
	failureTail,
	groupKind,
	groupSummary,
	label,
	plain,
	summarize,
} from "./format.ts";

test("summaries use tense, relative targets, requested ranges, and meaningful outcomes", () => {
	assert.deepEqual(
		summarize(
			"read",
			{ path: "/repo/src/main.ts", offset: 3, limit: 4 },
			"/repo"
		),
		{ verb: "Reading", target: "src/main.ts", detail: "3-6" }
	);
	assert.deepEqual(
		summarize("read", { path: "x" }, "/repo", {
			kind: "success",
			chip: "4 lines",
		}),
		{ verb: "Read", target: "x", detail: "4 lines" }
	);
	assert.equal(
		summarize("read", { path: "x", limit: 4 }, "/repo", {
			kind: "hard",
			chip: "failed",
		}).detail,
		"failed"
	);
	assert.equal(
		summarize("bash", { command: "pnpm\n test" }, "/repo", {
			kind: "success",
		}).target,
		"pnpm test"
	);
	assert.equal(
		summarize("edit", { path: "x" }, "/repo", { kind: "success" }).verb,
		"Edited"
	);
	assert.equal(
		summarize("write", { path: "x" }, "/repo", { kind: "success" }).verb,
		"Wrote"
	);
	assert.equal(
		summarize("grep", { pattern: "query" }, "/repo", {
			kind: "soft",
			chip: "no matches",
		}).detail,
		"no matches"
	);
	assert.equal(summarize("ls", {}, "/repo").target, ".");
	assert.equal(groupSummary("search", 4).target, "4 patterns");
	for (const tool of ["bash", "edit", "write", "foreign"])
		assert.equal(groupKind(tool), undefined);
});

test("foreign peeks never fall back to arbitrary arguments", () => {
	for (const args of [
		{ apiKey: "secret" },
		{ password: "secret" },
		{ access_token: "secret" },
		{ prompt: "secret" },
		{ headers: { authorization: "secret" } },
	]) {
		assert.equal(
			summarize("mcp__remote", args, "/repo").target,
			"mcp__remote"
		);
	}
	assert.equal(
		summarize("mcp__search", { query: "hello", token: "secret" }, "/repo")
			.target,
		"mcp__search hello"
	);
});

test("chrome text strips terminal controls and bounds labels and failure tails", () => {
	assert.equal(plain("a\x1b]52;c;ZXZpbA==\x07b\x1b[31mc\r\b"), "abc");
	assert.equal(label(" a\n b \u202ec "), "a b c");
	assert.equal(label("x".repeat(1000)).length, 120);
	assert.equal(
		failureTail(
			Array.from({ length: 30 }, (_, i) => `${i}`).join("\n")
		).split("\n").length,
		12
	);
	assert.ok(failureTail("x".repeat(100_000)).length <= 8000);
	assert.equal(compactLocation("/home/test/repo", "/home/test"), "~/repo");
	assert.equal(
		compactLocation("/home/testing", "/home/test"),
		"/home/testing"
	);
});
