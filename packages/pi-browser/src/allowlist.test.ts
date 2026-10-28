import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { join } from "node:path";
import { addToAllowlist, loadAllowlist } from "./allowlist.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-browser-allowlist-"));
}

describe("allowlist", () => {
	const dir = tempDir();
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("returns an empty set for a missing file", () => {
		assert.deepEqual(loadAllowlist(join(dir, "missing.json")), new Set());
	});

	it("returns an empty set for corrupt JSON", () => {
		const path = join(dir, "corrupt.json");
		writeFileSync(path, "{ not json", "utf8");
		assert.deepEqual(loadAllowlist(path), new Set());
	});

	it("ignores wrong shapes instead of trusting them", () => {
		const path = join(dir, "wrong-shape.json");
		writeFileSync(path, JSON.stringify({ version: 1, domains: "example.com" }), "utf8");
		assert.deepEqual(loadAllowlist(path), new Set());
		writeFileSync(path, JSON.stringify(["example.com"]), "utf8");
		assert.deepEqual(loadAllowlist(path), new Set());
		writeFileSync(
			path,
			JSON.stringify({ version: 1, domains: ["example.com", 42, null] }),
			"utf8"
		);
		assert.deepEqual(loadAllowlist(path), new Set(["example.com"]));
	});

	it("creates parent directories and merges on add", () => {
		const path = join(dir, "nested", "pi-browser-allowlist.json");
		addToAllowlist("example.com", path);
		addToAllowlist("example.co.uk", path);
		assert.deepEqual(loadAllowlist(path), new Set(["example.com", "example.co.uk"]));
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			version: number;
			domains: string[];
		};
		assert.equal(parsed.version, 1);
		assert.deepEqual(parsed.domains.sort(), ["example.co.uk", "example.com"]);
	});

	it("does not overwrite corrupt or unsupported configuration on permanent approval", () => {
		const path = join(dir, "preserve.json");
		for (const body of ["{broken", JSON.stringify({ version: 2, domains: ["example.com"] })]) {
			writeFileSync(path, body);
			assert.throws(() => addToAllowlist("other.com", path), /invalid Allowlist/);
			assert.equal(readFileSync(path, "utf8"), body);
			assert.deepEqual(loadAllowlist(path), new Set());
		}
	});

	it("writes privately without leaving temporary files behind", () => {
		const path = join(dir, "private", "allow.json");
		addToAllowlist("example.com", path);
		if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.deepEqual(readdirSync(join(dir, "private")), ["allow.json"]);
	});

	it("is idempotent for a duplicate domain and leaves the file valid JSON", () => {
		const path = join(dir, "dup.json");
		addToAllowlist("example.com", path);
		addToAllowlist("example.com", path);
		assert.deepEqual(loadAllowlist(path), new Set(["example.com"]));
	});
});
