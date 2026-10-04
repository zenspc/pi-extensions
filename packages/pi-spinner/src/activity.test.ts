import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatActivityMessage } from "./activity.ts";

describe("formatActivityMessage", () => {
	it("reads the basename of a path", () => {
		assert.equal(formatActivityMessage("read", { path: "/tmp/foo/bar.ts" }), "Reading bar.ts");
	});

	it("runs only the first token of a bash command", () => {
		assert.equal(formatActivityMessage("bash", { command: "pnpm test" }), "Running pnpm");
	});

	it("strips ANSI from a grep pattern", () => {
		const result = formatActivityMessage("grep", { pattern: "\u001b[31mred" });
		assert.ok(result);
		assert.equal(result.includes("\u001b"), false);
		assert.ok(result.startsWith("Searching"));
	});

	it("calls an unknown tool by its sanitized name", () => {
		assert.equal(formatActivityMessage("thatname", undefined), "Calling thatname");
	});

	it("returns undefined for an empty or non-string tool name", () => {
		assert.equal(formatActivityMessage("", undefined), undefined);
		assert.equal(formatActivityMessage(null, undefined), undefined);
		assert.equal(formatActivityMessage(12, undefined), undefined);
	});

	it("reads only the basename of a traversal path", () => {
		assert.equal(
			formatActivityMessage("read", { path: "../../../etc/passwd" }),
			"Reading passwd",
		);
	});

	it("caps an overlong pattern to 40 after the verb and space", () => {
		const result = formatActivityMessage("grep", { pattern: "x".repeat(80) });
		assert.equal(result, `Searching ${"x".repeat(40)}`);
	});

	it("peeks only the basename for an unknown tool path", () => {
		assert.equal(
			formatActivityMessage("other", { path: "/tmp/foo/bar.ts" }),
			"Calling other bar.ts",
		);
	});

	it("keeps the real basename when the path is longer than 40", () => {
		assert.equal(
			formatActivityMessage("read", { path: `${"a".repeat(50)}/bar.ts` }),
			"Reading bar.ts",
		);
	});

	it("uses only the verb when a known tool has no peek", () => {
		assert.equal(formatActivityMessage("read", undefined), "Reading");
	});
});
