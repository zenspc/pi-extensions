import assert from "node:assert/strict";
import {
	chmodSync,
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
	baseModelSelector,
	configPath,
	defaultConfig,
	formatRoleTable,
	formatPanelStatus,
	getAgentDir,
	isSafeModelSelector,
	legacyMarkdownPath,
	loadConfig as readConfig,
	migrateLegacyMarkdownIfNeeded,
	modelsForRole,
	parseConfig,
	parseLegacyMarkdown,
	saveConfig,
} from "./config.ts";

const MAX_CONFIG_BYTES = 100_000;
const loadConfig = (path: string) => readConfig(path).config;

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
				"arena runners": ["anthropic/ok", "bad", "__proto__/x"],
			},
		});
		assert.equal(parsed.roles["bug-fix"], "anthropic/claude-opus-4-6");
		assert.equal(parsed.roles["not-a-role"], undefined);
		assert.equal(parsed.roles["how explorer"], "inherit-parent");
		assert.deepEqual(parsed.roles["arena runners"], ["anthropic/ok"]);

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

	it("recognizes native thinking suffixes without stripping model-id tags", () => {
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
			const selector = `openrouter/owner/model:${level}`;
			assert.equal(isSafeModelSelector(selector), true);
			assert.equal(baseModelSelector(selector), "openrouter/owner/model");
		}
		assert.equal(baseModelSelector("ollama/model:latest"), "ollama/model:latest");
		assert.equal(baseModelSelector("ollama/model:7b:high"), "ollama/model:7b");
		assert.equal(isSafeModelSelector("openai/:high"), false);
		assert.equal(isSafeModelSelector("inherit-parent:high"), false);
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
					"arena runners": ["anthropic/a:off", "openai/b:max", "inherit-parent"],
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

describe("configuration diagnostics", () => {
	it("distinguishes missing, loaded, partial, and invalid without exposing rejected values", (t) => {
		const dir = tempDir("pstack-diagnostics-");
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const path = join(dir, "models.json");
		assert.equal(readConfig(path).status, "missing");
		assert.deepEqual(readConfig(path).diagnostics, []);
		assert.equal(saveConfig(defaultConfig(), path), true);
		assert.equal(readConfig(path).status, "loaded");
		writeFileSync(path, JSON.stringify({ version: 1, skillsEnabled: "secret", roles: {
			"bug-fix": "openai/good", "arena runners": ["inherit-parent", "secret", "openai/good"],
			"how explorer": "secret", unknown: "secret",
		} }));
		const partial = readConfig(path);
		assert.equal(partial.path, path);
		assert.equal(partial.status, "partial");
		assert.equal(partial.config.roles["bug-fix"], "openai/good");
		assert.deepEqual(partial.config.roles["arena runners"], ["inherit-parent", "openai/good"]);
		assert.match(partial.diagnostics.join("\n"), /arena runners.*\[1\]/);
		assert.match(partial.diagnostics.join("\n"), /how explorer/);
		assert.match(partial.diagnostics.join("\n"), /unknown role/);
		assert.match(partial.diagnostics.join("\n"), /skillsEnabled/);
		assert.doesNotMatch(partial.diagnostics.join("\n"), /secret/);
		for (const body of ["{secret", "null", '{"version":2,"roles":{}}', '{"version":1,"roles":[]}']) {
			writeFileSync(path, body);
			const result = readConfig(path);
			assert.equal(result.status, "invalid", body);
			assert.ok(result.diagnostics.length > 0);
			assert.deepEqual(result.config, defaultConfig());
			assert.equal(readFileSync(path, "utf8"), body);
		}
	});

	it("reports unreadable existing config without exposing its contents", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
		const dir = tempDir("pstack-unreadable-");
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const path = join(dir, "models.json");
		writeFileSync(path, "private-config");
		chmodSync(path, 0);
		const result = readConfig(path);
		assert.equal(result.status, "invalid");
		assert.deepEqual(result.diagnostics, ["Cannot read configuration."]);
	});

	it("reports directories, oversized files, and dangling symlinks as invalid, not missing", (t) => {
		const dir = tempDir("pstack-invalid-path-");
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		assert.equal(readConfig(dir).status, "invalid");
		const path = join(dir, "models.json");
		writeFileSync(path, "x".repeat(MAX_CONFIG_BYTES + 1));
		assert.match(readConfig(path).diagnostics.join(), /100000/);
		rmSync(path);
		symlinkSync(join(dir, "absent"), path);
		assert.equal(readConfig(path).status, "invalid");
		assert.equal(saveConfig(defaultConfig(), path), false);
		const regular = join(dir, "regular.json");
		writeFileSync(regular, "{}");
		assert.equal(readConfig(join(regular, "child")).status, "invalid");
	});
});

describe("parseLegacyMarkdown", () => {
	it("reads the setup-pstack template shape", () => {
		const parsed = parseLegacyMarkdown(`
# pstack model configuration. comments ignored

feature, refactoring: xai/grok-4.6-fast
arena runners: anthropic/claude-fable-5[high], openai/gpt-5.6
unknown role: anthropic/claude-opus-4-6

bug-fix: openai/gpt-5.6
`);
		assert.equal(parsed.roles["feature, refactoring"], "xai/grok-4.6-fast");
		assert.deepEqual(parsed.roles["arena runners"], [
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

describe("migration safety", () => {
	it("never migrates over a broken JSON file or dangling symlink", (t) => {
		const dir = tempDir("pstack-migration-broken-");
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const jsonPath = join(dir, "models.json");
		const mdPath = join(dir, "pstack-models.md");
		writeFileSync(mdPath, "bug-fix: openai/example\n");
		writeFileSync(jsonPath, "{broken");
		assert.equal(migrateLegacyMarkdownIfNeeded(jsonPath, mdPath), undefined);
		assert.equal(readFileSync(jsonPath, "utf8"), "{broken");
		rmSync(jsonPath);
		symlinkSync(join(dir, "absent"), jsonPath);
		assert.equal(migrateLegacyMarkdownIfNeeded(jsonPath, mdPath), undefined);
		assert.ok(lstatSync(jsonPath).isSymbolicLink());
	});
});

describe("formatRoleTable", () => {
	it("injects nothing when every role inherits", () => {
		assert.equal(formatRoleTable(defaultConfig()), "");
		assert.equal(formatRoleTable(parseConfig({ version: 1, roles: { "bug-fix": "auto" } })), "");
	});

	it("preserves inherited seats, order, and explicit all-inherited panel sizes", () => {
		const cfg = defaultConfig();
		cfg.roles["arena runners"] = ["inherit-parent", "openai/example", "auto", "inherit-parent"];
		cfg.roles["interrogate reviewers"] = ["auto", "inherit-parent", "auto"];
		assert.equal(formatRoleTable(cfg), "arena runners: inherit-parent, openai/example, auto, inherit-parent\ninterrogate reviewers: auto, inherit-parent, auto");
		cfg.roles["interrogate reviewers"] = ["inherit-parent"];
		assert.match(formatRoleTable(cfg), /interrogate reviewers: inherit-parent$/);
	});

	it("lists only non-default roles", () => {
		const cfg = parseConfig({
			version: 1,
			roles: {
				"bug-fix": "anthropic/claude-opus-4-6",
				"arena runners": ["anthropic/a", "openai/b"],
			},
		});
		assert.equal(
			formatRoleTable(cfg),
			"bug-fix: anthropic/claude-opus-4-6\narena runners: anthropic/a, openai/b",
		);
	});
});

describe("formatPanelStatus", () => {
	it("shows thinking effort without counting it as model diversity", () => {
		const cfg = defaultConfig();
		cfg.roles["arena runners"] = ["openai/parent:low", "openai/parent:high", "inherit-parent"];
		assert.match(formatPanelStatus(cfg, "openai/parent"), /arena runners: openai\/parent:low, openai\/parent:high, openai\/parent \(inherited\) \[same-model panel\]/);
		assert.equal(formatRoleTable(cfg), "arena runners: openai/parent:low, openai/parent:high, inherit-parent");
	});

	it("resolves default inherited panels without claiming model diversity", () => {
		const output = formatPanelStatus(defaultConfig(), "openai/parent");
		assert.match(output, /interrogate reviewers: openai\/parent \(inherited\), openai\/parent \(inherited\) \[same-model panel\]/);
		assert.match(output, /arena cross-judge pool: .*\[same-model pool; choose one judge\]/);
		assert.match(formatPanelStatus(defaultConfig()), /parent model unresolved/);
	});

	it("preserves seats and resolves aliases when describing mixed panels", () => {
		const cfg = defaultConfig();
		cfg.roles["interrogate reviewers"] = ["auto", "openai/parent"];
		assert.match(formatPanelStatus(cfg, "openai/parent"), /interrogate reviewers: .*\[same-model panel\]/);
		cfg.roles["interrogate reviewers"] = ["inherit-parent", "other/model", "auto"];
		assert.match(formatPanelStatus(cfg, "openai/parent"), /interrogate reviewers: openai\/parent \(inherited\), other\/model, openai\/parent \(inherited\) \[distinct selectors; family diversity not guaranteed\]/);
		cfg.roles["interrogate reviewers"] = ["inherit-parent"];
		assert.match(formatPanelStatus(cfg, "openai/parent"), /interrogate reviewers: openai\/parent \(inherited\) \[single-model panel\]/);
	});
});

describe("modelsForRole", () => {
	it("returns array form without dropping inherited seats", () => {
		const cfg = parseConfig({
			version: 1,
			roles: {
				"bug-fix": "inherit-parent",
				"how explorer": "auto",
				"arena runners": ["anthropic/a", "inherit-parent", "auto", "openai/b"],
			},
		});
		assert.deepEqual(modelsForRole(cfg, "bug-fix"), ["inherit-parent"]);
		assert.deepEqual(modelsForRole(cfg, "how explorer"), ["auto"]);
		assert.deepEqual(modelsForRole(cfg, "arena runners"), ["anthropic/a", "inherit-parent", "auto", "openai/b"]);
		assert.deepEqual(modelsForRole(cfg, "hillclimb"), ["inherit-parent"]);
	});
});
