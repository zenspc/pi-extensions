import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { acquireLease, LEASE_FILE } from "./lease.ts";

it("excludes another process until release and releases idempotently", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-lease-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const release = acquireLease(dir);
	t.after(release);
	const run = () =>
		spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`import { acquireLease } from ${JSON.stringify(
					new URL("./lease.ts", import.meta.url).href
				)}; acquireLease(${JSON.stringify(dir)})();`,
			],
			{ encoding: "utf8" }
		);
	const denied = run();
	assert.equal(denied.status, 1);
	assert.match(denied.stderr, /already leased/);
	release();
	release();
	assert.equal(run().status, 0);
});

it("never reclaims a crashed or malformed lease automatically", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-lease-stale-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, LEASE_FILE);
	writeFileSync(path, "partial write");
	assert.throws(() => acquireLease(dir), /confirm the owner/);
	assert.equal(readFileSync(path, "utf8"), "partial write");
});

it("does not remove a replaced lease and restricts file permissions", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-lease-owner-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const release = acquireLease(dir);
	const path = join(dir, LEASE_FILE);
	if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
	writeFileSync(path, "another owner");
	release();
	assert.equal(readFileSync(path, "utf8"), "another owner");
});
