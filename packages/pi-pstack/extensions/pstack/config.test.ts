import assert from "node:assert/strict";
import {
	lstatSync,
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
	ROLE_NAMES,
	configPath,
	defaultConfig,
	formatRoleTable,
	getAgentDir,
	isSafeModelSelector,
	legacyMarkdownPath,
	loadConfig,
	migrateLegacyMarkdownIfNeeded,
	modelsForRole,
	parseConfig,
	parseLegacyMarkdown,
	saveConfig,
} from "./config.ts";

const MAX_CONFIG_BYTES = 100_000;

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("defaultConfig", () => {
	it("sets every role to inherit-parent", () => {
		const cfg = defaultConfig();
		assert.equal(cfg.version, 1);
		assert.equal(Object.keys(cfg.roles).length, ROLE_NAMES.length);
		for (const role of ROLE_NAMES) {
			assert.equal(cfg.roles[role], "inherit-parent");
		}
	});

	it("enables skills by default", () => {
		assert.equal(defaultConfig().skillsEnabled, true);
	});
});

describe("parseConfig", () => {
	it("drops unknown roles, bad selectors, and wrong versions", () => {
		const parsed = parseConfig({
			version: 1,
			roles: {
				"bug-fix": "anthropic/claude-opus-4-6",
				"not-a-role": "anthropic/claude-opus-4-6",
				"how explorer": "no-slash",
				"how critics": ["anthropic/ok", "bad", "__proto__/x"],
			},
		});
		assert.equal(parsed.roles["bug-fix"], "anthropic/claude-opus-4-6");
		assert.equal(parsed.roles["not-a-role"], undefined);
		assert.equal(parsed.roles["how explorer"], "inherit-parent");
		assert.deepEqual(parsed.roles["how critics"], ["anthropic/ok"]);

		const wrongVersion = parseConfig({
			version: 2,
			roles: { "bug-fix": "anthropic/claude-opus-4-6" },
		});
		assert.deepEqual(wrongVersion, defaultConfig());
	});

	it("keeps skillsEnabled false from stored JSON", () => {
		assert.equal(parseConfig({ version: 1, roles: {}, skillsEnabled: false }).skillsEnabled, false);
	});

	it("defaults skillsEnabled to true for missing, non-boolean, and wrong-version input", () => {
		assert.equal(parseConfig({ version: 1, roles: {} }).skillsEnabled, true);
		assert.equal(parseConfig({ version: 1, roles: {}, skillsEnabled: "off" }).skillsEnabled, true);
		assert.equal(parseConfig({ version: 2, roles: {}, skillsEnabled: false }).skillsEnabled, true);
		assert.equal(parseConfig(null).skillsEnabled, true);
	});
});

describe("isSafeModelSelector", () => {
	it("accepts inherit-parent, auto, provider/id, and [high] suffix", () => {
		assert.equal(isSafeModelSelector("inherit-parent"), true);
		assert.equal(isSafeModelSelector("auto"), true);
		assert.equal(isSafeModelSelector("anthropic/claude-opus-4-6"), true);
		assert.equal(isSafeModelSelector("anthropic/claude-opus-4-6[high]"), true);
	});

	it("rejects empty, no slash, __proto__/x, and control chars", () => {
		assert.equal(isSafeModelSelector(""), false);
		assert.equal(isSafeModelSelector("no-slash"), false);
		assert.equal(isSafeModelSelector("__proto__/x"), false);
		assert.equal(isSafeModelSelector("a/b\nc"), false);
	});
});

describe("getAgentDir / configPath / legacyMarkdownPath", () => {
	it("defaults to ~/.pi/agent and the pstack JSON / markdown paths", () => {
		assert.equal(getAgentDir({}, () => "/home/u"), join("/home/u", ".pi", "agent"));
		assert.equal(
			configPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "pstack", "models.json"),
		);
		assert.equal(
			legacyMarkdownPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "pstack-models.md"),
		);
	});

	it("honors PI_CODING_AGENT_DIR and ~ expansion", () => {
		assert.equal(
			configPath({ PI_CODING_AGENT_DIR: "~/custom-agent" }, () => "/home/u"),
			join("/home/u", "custom-agent", "pstack", "models.json"),
		);
		assert.equal(
			configPath({ PI_CODING_AGENT_DIR: "/abs/agent" }, () => "/home/u"),
			join("/abs/agent", "pstack", "models.json"),
		);
	});
});

describe("loadConfig / saveConfig", () => {
	it("returns default for a missing file", () => {
		const dir = tempDir("pstack-missing-");
		try {
			assert.deepEqual(loadConfig(join(dir, "models.json")), defaultConfig());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns default for a symlink", () => {
		const dir = tempDir("pstack-link-");
		const target = join(dir, "target.json");
		const link = join(dir, "models.json");
		try {
			writeFileSync(target, JSON.stringify({ version: 1, roles: { "bug-fix": "anthropic/x" } }), "utf8");
			symlinkSync(target, link);
			assert.equal(lstatSync(link).isSymbolicLink(), true);
			assert.deepEqual(loadConfig(link), defaultConfig());
			assert.equal(saveConfig(defaultConfig(), link), false);
			assert.equal(lstatSync(link).isSymbolicLink(), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns default for an oversized file", () => {
		const dir = tempDir("pstack-big-");
		const path = join(dir, "models.json");
		try {
			writeFileSync(path, "x".repeat(MAX_CONFIG_BYTES + 1), "utf8");
			assert.deepEqual(loadConfig(path), defaultConfig());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns default for invalid JSON", () => {
		const dir = tempDir("pstack-badjson-");
		const path = join(dir, "models.json");
		try {
			writeFileSync(path, "{not json", "utf8");
			assert.deepEqual(loadConfig(path), defaultConfig());
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips a saved config", () => {
		const dir = tempDir("pstack-roundtrip-");
		const path = join(dir, "pstack", "models.json");
		try {
			const cfg = parseConfig({
				version: 1,
				roles: {
					"bug-fix": "anthropic/claude-opus-4-6",
					"how critics": ["anthropic/a", "openai/b"],
				},
			});
			assert.equal(saveConfig(cfg, path), true);
			assert.deepEqual(loadConfig(path), cfg);
			if (process.platform !== "win32") {
				assert.equal(lstatSync(path).mode & 0o777, 0o600);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips skillsEnabled false through save and load", () => {
		const dir = tempDir("pstack-skills-flag-");
		const path = join(dir, "pstack", "models.json");
		try {
			const cfg = { ...defaultConfig(), skillsEnabled: false };
			assert.equal(saveConfig(cfg, path), true);
			assert.equal(loadConfig(path).skillsEnabled, false);
			assert.equal(JSON.parse(readFileSync(path, "utf8")).skillsEnabled, false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("parseLegacyMarkdown", () => {
	it("reads the setup-pstack template shape", () => {
		const parsed = parseLegacyMarkdown(`
# pstack model configuration. comments ignored

feature, refactoring: xai/grok-4.6-fast
how critics: anthropic/claude-fable-5[high], openai/gpt-5.6
unknown role: anthropic/claude-opus-4-6

bug-fix: openai/gpt-5.6
`);
		assert.equal(parsed.roles["feature, refactoring"], "xai/grok-4.6-fast");
		assert.deepEqual(parsed.roles["how critics"], [
			"anthropic/claude-fable-5[high]",
			"openai/gpt-5.6",
		]);
		assert.equal(parsed.roles["bug-fix"], "openai/gpt-5.6");
		assert.equal(parsed.roles["unknown role"], undefined);
		assert.equal(parsed.roles["hillclimb"], "inherit-parent");
	});
});

describe("migrateLegacyMarkdownIfNeeded", () => {
	it("writes JSON when only markdown exists, and is a no-op when JSON already exists", () => {
		const dir = tempDir("pstack-migrate-");
		const jsonPath = join(dir, "models.json");
		const mdPath = join(dir, "pstack-models.md");
		try {
			writeFileSync(mdPath, "bug-fix: anthropic/claude-opus-4-6\n", "utf8");
			const migrated = migrateLegacyMarkdownIfNeeded(jsonPath, mdPath);
			assert.ok(migrated);
			assert.equal(migrated.roles["bug-fix"], "anthropic/claude-opus-4-6");
			assert.equal(readFileSync(mdPath, "utf8"), "bug-fix: anthropic/claude-opus-4-6\n");
			assert.deepEqual(loadConfig(jsonPath), migrated);

			writeFileSync(mdPath, "hillclimb: openai/gpt-5.6\n", "utf8");
			const again = migrateLegacyMarkdownIfNeeded(jsonPath, mdPath);
			assert.equal(again, undefined);
			assert.equal(loadConfig(jsonPath).roles["bug-fix"], "anthropic/claude-opus-4-6");
			assert.equal(loadConfig(jsonPath).roles.hillclimb, "inherit-parent");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("formatRoleTable", () => {
	it("injects nothing when every role inherits", () => {
		assert.equal(formatRoleTable(defaultConfig()), "");
		assert.equal(formatRoleTable(parseConfig({ version: 1, roles: { "bug-fix": "auto" } })), "");
	});

	it("lists only non-default roles", () => {
		const cfg = parseConfig({
			version: 1,
			roles: {
				"bug-fix": "anthropic/claude-opus-4-6",
				"how critics": ["anthropic/a", "openai/b"],
			},
		});
		assert.equal(
			formatRoleTable(cfg),
			"bug-fix: anthropic/claude-opus-4-6\nhow critics: anthropic/a, openai/b",
		);
	});
});

describe("modelsForRole", () => {
	it("returns array form and filters inherit-parent and auto", () => {
		const cfg = parseConfig({
			version: 1,
			roles: {
				"bug-fix": "inherit-parent",
				"how explorer": "auto",
				"how critics": ["anthropic/a", "inherit-parent", "auto", "openai/b"],
			},
		});
		assert.deepEqual(modelsForRole(cfg, "bug-fix"), []);
		assert.deepEqual(modelsForRole(cfg, "how explorer"), []);
		assert.deepEqual(modelsForRole(cfg, "how critics"), ["anthropic/a", "openai/b"]);
		assert.deepEqual(modelsForRole(cfg, "hillclimb"), []);
	});
});
