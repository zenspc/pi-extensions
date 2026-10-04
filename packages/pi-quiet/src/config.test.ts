import assert from "node:assert/strict";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	CONFIG_FILENAME,
	MAX_CONFIG_BYTES,
	defaultQuietConfig,
	getConfigPath,
	loadQuietConfig,
	parseQuietConfig,
	saveQuietConfig,
} from "./config.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-quiet-"));
}

describe("defaultQuietConfig", () => {
	it("defaults Quiet Display on", () => {
		assert.deepEqual(defaultQuietConfig(), { enabled: true });
	});
});

describe("parseQuietConfig", () => {
	it("accepts boolean enabled", () => {
		assert.deepEqual(parseQuietConfig({ enabled: false }), { enabled: false });
		assert.deepEqual(parseQuietConfig({ enabled: true }), { enabled: true });
	});

	it("ignores invalid shapes and falls back to default", () => {
		assert.deepEqual(parseQuietConfig(null), defaultQuietConfig());
		assert.deepEqual(parseQuietConfig([]), defaultQuietConfig());
		assert.deepEqual(parseQuietConfig("nope"), defaultQuietConfig());
		assert.deepEqual(parseQuietConfig({ enabled: "yes" }), defaultQuietConfig());
		assert.deepEqual(parseQuietConfig({}), defaultQuietConfig());
	});

	it("strips unknown keys", () => {
		assert.deepEqual(parseQuietConfig({ enabled: false, density: "full" }), { enabled: false });
	});
});

describe("getConfigPath", () => {
	it("defaults to ~/.pi/agent/extensions/quiet.json", () => {
		assert.equal(
			getConfigPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "extensions", CONFIG_FILENAME),
		);
	});

	it("honors PI_CODING_AGENT_DIR and expands ~", () => {
		assert.equal(
			getConfigPath({ PI_CODING_AGENT_DIR: "~/custom-agent" }, () => "/home/u"),
			join("/home/u", "custom-agent", "extensions", CONFIG_FILENAME),
		);
		assert.equal(
			getConfigPath({ PI_CODING_AGENT_DIR: "/abs/agent" }, () => "/home/u"),
			join("/abs/agent", "extensions", CONFIG_FILENAME),
		);
	});
});

describe("loadQuietConfig / saveQuietConfig", () => {
	it("loads default when missing", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "missing.json");
			assert.deepEqual(loadQuietConfig(path), defaultQuietConfig());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips enabled false with mode 0o600", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "extensions", CONFIG_FILENAME);
			assert.equal(saveQuietConfig({ enabled: false }, path), true);
			assert.deepEqual(loadQuietConfig(path), { enabled: false });
			const raw = JSON.parse(readFileSync(path, "utf8"));
			assert.deepEqual(raw, { enabled: false });
			assert.equal(lstatSync(path).mode & 0o777, 0o600);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores oversized, non-regular, and invalid JSON", () => {
		const dir = tempDir();
		try {
			const big = join(dir, "big.json");
			writeFileSync(big, `{ "enabled": ${"false,".repeat(MAX_CONFIG_BYTES)} }`);
			assert.deepEqual(loadQuietConfig(big), defaultQuietConfig());

			const bad = join(dir, "bad.json");
			writeFileSync(bad, "{ not json");
			assert.deepEqual(loadQuietConfig(bad), defaultQuietConfig());

			const target = join(dir, "target.json");
			const link = join(dir, "link.json");
			writeFileSync(target, JSON.stringify({ enabled: false }));
			symlinkSync(target, link);
			assert.deepEqual(loadQuietConfig(link), defaultQuietConfig());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to overwrite a non-regular destination", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "quiet.json");
			mkdirSync(path);
			assert.equal(saveQuietConfig({ enabled: false }, path), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
