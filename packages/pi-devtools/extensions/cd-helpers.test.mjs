import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCdArgs, pathsEqual, resolveTargetPath, tokenizeArgs } from "./cd-helpers.mjs";

describe("tokenizeArgs", () => {
	it("splits on whitespace", () => {
		assert.deepEqual(tokenizeArgs("  a  b\tc  "), ["a", "b", "c"]);
	});

	it("keeps quoted spans", () => {
		assert.deepEqual(tokenizeArgs(`--new "/tmp/my dir" extra`), ["--new", "/tmp/my dir", "extra"]);
		assert.deepEqual(tokenizeArgs(`'~/proj with spaces'`), ["~/proj with spaces"]);
	});
});

describe("parseCdArgs", () => {
	it("defaults to continue with path", () => {
		assert.deepEqual(parseCdArgs("../other"), {
			mode: "continue",
			pathArg: "../other",
			errors: [],
		});
	});

	it("parses --new and --fork", () => {
		assert.equal(parseCdArgs("--new /tmp/a").mode, "new");
		assert.equal(parseCdArgs("/tmp/a --fork").mode, "fork");
		assert.equal(parseCdArgs("--fork --new /tmp/a").errors.length > 0, true);
	});

	it("joins multi-token paths", () => {
		assert.equal(parseCdArgs("foo bar").pathArg, "foo bar");
	});

	it("rejects unknown flags", () => {
		const r = parseCdArgs("--wat /tmp");
		assert.ok(r.errors.some((e) => e.includes("--wat")));
	});

	it("allows empty path for usage", () => {
		assert.deepEqual(parseCdArgs(""), { mode: "continue", pathArg: null, errors: [] });
		assert.deepEqual(parseCdArgs("--new"), { mode: "new", pathArg: null, errors: [] });
	});
});

describe("resolveTargetPath", () => {
	const home = "/home/testuser";
	const base = "/work/proj";

	it("expands ~", () => {
		assert.equal(resolveTargetPath("~", base, home), home);
		assert.equal(resolveTargetPath("~/code", base, home), `${home}/code`);
	});

	it("resolves relative to base", () => {
		assert.equal(resolveTargetPath("../other", base, home), "/work/other");
	});

	it("keeps absolute paths", () => {
		assert.equal(resolveTargetPath("/abs/path", base, home), "/abs/path");
	});
});

describe("pathsEqual", () => {
	it("normalizes trailing segments", () => {
		assert.equal(pathsEqual("/a/b", "/a/b"), true);
		assert.equal(pathsEqual("/a/b/.", "/a/b"), true);
	});
});
