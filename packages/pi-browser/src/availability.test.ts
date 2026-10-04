import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	AVAILABILITY_FILENAME,
	applyToolAvailability,
	getAvailabilityPath,
	loadToolAvailability,
	saveToolAvailability,
} from "./availability.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-browser-availability-"));
}

describe("getAvailabilityPath", () => {
	it("sits next to other extension state, not the Allowlist file", () => {
		assert.equal(
			getAvailabilityPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "extensions", AVAILABILITY_FILENAME),
		);
		assert.notEqual(AVAILABILITY_FILENAME, "pi-browser-allowlist.json");
	});

	it("honors PI_CODING_AGENT_DIR", () => {
		assert.equal(
			getAvailabilityPath({ PI_CODING_AGENT_DIR: "/abs/agent" }, () => "/home/u"),
			join("/abs/agent", "extensions", AVAILABILITY_FILENAME),
		);
	});
});

describe("loadToolAvailability / saveToolAvailability", () => {
	const dir = tempDir();
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("treats a missing sticky file as on", () => {
		assert.deepEqual(loadToolAvailability(join(dir, "missing.json")), { available: true });
	});

	it("round-trips off", () => {
		const path = join(dir, "nested", AVAILABILITY_FILENAME);
		assert.equal(saveToolAvailability({ available: false }, path), true);
		assert.deepEqual(loadToolAvailability(path), { available: false });
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { available: false });
	});

	it("falls back to on for invalid JSON", () => {
		const path = join(dir, "corrupt.json");
		writeFileSync(path, "{ not json", "utf8");
		assert.deepEqual(loadToolAvailability(path), { available: true });
	});

	it("returns false when save cannot write", () => {
		const path = join(dir, "not-a-file");
		mkdirSync(path);
		assert.equal(saveToolAvailability({ available: false }, path), false);
	});
});

describe("applyToolAvailability", () => {
	it("hides Browser Tools and leaves other tools", () => {
		let active = ["read", "browser_navigate", "bash", "browser_snapshot"];
		applyToolAvailability(
			{
				getActiveTools: () => active,
				setActiveTools: (names) => {
					active = names;
				},
			},
			false,
			["browser_navigate", "browser_snapshot"],
		);
		assert.deepEqual(active, ["read", "bash"]);
	});

	it("offers Browser Tools again without dropping others", () => {
		let active = ["read", "bash"];
		applyToolAvailability(
			{
				getActiveTools: () => active,
				setActiveTools: (names) => {
					active = names;
				},
			},
			true,
			["browser_navigate", "browser_snapshot"],
		);
		assert.deepEqual(active, ["read", "bash", "browser_navigate", "browser_snapshot"]);
	});
});
