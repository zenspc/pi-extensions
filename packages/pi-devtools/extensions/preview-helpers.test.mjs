import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { MAX_PREVIEW_BYTES, readPreviewFile, resolvePreviewTarget } from "./preview-helpers.mjs";

const root = mkdtempSync(join(tmpdir(), "preview-helpers-"));
const home = join(root, "home");
const cwd = join(root, "work");
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });
mkdirSync(join(home, "docs"), { recursive: true });

after(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("resolvePreviewTarget", () => {
	it("rejects empty args with usage error", () => {
		assert.deepEqual(resolvePreviewTarget("", cwd), { ok: false, error: "usage: /preview <file.md>" });
		assert.deepEqual(resolvePreviewTarget("   ", cwd), { ok: false, error: "usage: /preview <file.md>" });
	});

	it("resolves a relative path against cwd", () => {
		writeFileSync(join(cwd, "notes.md"), "# hi");
		const r = resolvePreviewTarget("notes.md", cwd);
		assert.ok(r.ok);
		assert.equal(r.ok && r.absolutePath, join(cwd, "notes.md"));
		assert.equal(r.ok && r.displayPath, "notes.md");
	});

	it("keeps an absolute path as-is", () => {
		writeFileSync(join(root, "absolute.md"), "# abs");
		const r = resolvePreviewTarget(join(root, "absolute.md"), cwd);
		assert.ok(r.ok);
		assert.equal(r.ok && r.absolutePath, join(root, "absolute.md"));
	});

	it("expands ~/ using the injected home", () => {
		writeFileSync(join(home, "docs", "readme.md"), "# home");
		const r = resolvePreviewTarget("~/docs/readme.md", cwd, home);
		assert.ok(r.ok);
		assert.equal(r.ok && r.absolutePath, join(home, "docs", "readme.md"));
	});

	it("expands bare ~ to the injected home prefix", () => {
		const r = resolvePreviewTarget("~", cwd, home);
		assert.equal(r.ok, false);
		assert.match(r.ok === false ? r.error : "", new RegExp(`^${home.replaceAll("/", "\\/")}`));
	});

	it("appends .md when the final segment has no dot and the file exists", () => {
		writeFileSync(join(cwd, "CONTRIBUTING.md"), "# contributing");
		const r = resolvePreviewTarget("CONTRIBUTING", cwd);
		assert.ok(r.ok);
		assert.equal(r.ok && r.absolutePath, join(cwd, "CONTRIBUTING.md"));
		assert.equal(r.ok && r.displayPath, "CONTRIBUTING.md");
	});

	it("misses cleanly when .md append finds nothing", () => {
		const r = resolvePreviewTarget("nope", cwd);
		assert.deepEqual(r, { ok: false, error: "nope: no such file" });
	});

	it("does not append .md when the segment already has an extension", () => {
		const r = resolvePreviewTarget("missing.txt", cwd);
		assert.deepEqual(r, { ok: false, error: "missing.txt: no such file" });
	});

	it("rejects directories", () => {
		mkdirSync(join(cwd, "sub"), { recursive: true });
		const r = resolvePreviewTarget("sub", cwd);
		assert.deepEqual(r, { ok: false, error: "sub: not a file" });
	});

	it("uses absolute display paths outside cwd", () => {
		writeFileSync(join(home, "outside.md"), "# out");
		const r = resolvePreviewTarget("~/outside.md", cwd, home);
		assert.ok(r.ok);
		assert.equal(r.ok && r.displayPath, join(home, "outside.md"));
	});
});

describe("readPreviewFile", () => {
	it("reads contents on success", () => {
		const p = join(cwd, "ok-read.md");
		writeFileSync(p, "# hello\nworld");
		assert.deepEqual(readPreviewFile(p), { ok: true, content: "# hello\nworld" });
	});

	it("rejects files just over the size cap", () => {
		const p = join(cwd, "big.md");
		writeFileSync(p, "x".repeat(MAX_PREVIEW_BYTES + 1));
		const r = readPreviewFile(p);
		assert.equal(r.ok, false);
		if (!r.ok) assert.equal(r.error, "big.md: file exceeds 512 KiB preview limit");
	});

	it("accepts files exactly at the cap", () => {
		const p = join(cwd, "exact.md");
		writeFileSync(p, "y".repeat(MAX_PREVIEW_BYTES));
		assert.equal(readPreviewFile(p).ok, true);
	});

	it("maps read errors to basename-prefixed messages", () => {
		const r = readPreviewFile(join(cwd, "ghost.md"));
		assert.equal(r.ok, false);
		assert.match(r.ok === false ? r.error : "", /^ghost\.md: /);
	});
});
