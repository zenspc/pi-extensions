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
	formatPreferredThinkingHelp,
	getAgentDir,
	getConfigPath,
	getPreferredThinkingArgumentCompletions,
	hasCliThinkingOverride,
	isSafeModelKey,
	isValidThinkingLevel,
	loadPreferredThinkingConfig,
	MAX_CONFIG_BYTES,
	MAX_CONFIG_ENTRIES,
	modelKey,
	parsePreferredThinkingConfig,
	resolvePreferredLevel,
	savePreferredThinkingConfig,
	shouldApplyOnModelSelect,
	shouldApplyOnSessionStart,
	SUBCOMMANDS,
	VALID_THINKING_LEVELS,
} from "./preferred-thinking-helpers.ts";

function asPlain(map: Record<string, string>) {
	return { ...map };
}

describe("isValidThinkingLevel", () => {
	it("accepts all known levels", () => {
		for (const level of VALID_THINKING_LEVELS) {
			assert.equal(isValidThinkingLevel(level), true);
		}
	});

	it("rejects invalid values", () => {
		assert.equal(isValidThinkingLevel("super"), false);
		assert.equal(isValidThinkingLevel(""), false);
		assert.equal(isValidThinkingLevel(null), false);
		assert.equal(isValidThinkingLevel(3), false);
	});
});

describe("isSafeModelKey", () => {
	it("accepts normal provider/id keys including multi-segment ids", () => {
		assert.equal(isSafeModelKey("anthropic/claude-opus-4-6"), true);
		assert.equal(isSafeModelKey("fireworks/accounts/fireworks/models/foo"), true);
	});

	it("rejects empty sides, dangerous parts, control chars, and oversize keys", () => {
		assert.equal(isSafeModelKey(""), false);
		assert.equal(isSafeModelKey("/id"), false);
		assert.equal(isSafeModelKey("provider/"), false);
		assert.equal(isSafeModelKey("no-slash"), false);
		assert.equal(isSafeModelKey("__proto__/x"), false);
		assert.equal(isSafeModelKey("a/constructor"), false);
		assert.equal(isSafeModelKey("a/b\nc"), false);
		assert.equal(isSafeModelKey(`a/${"x".repeat(300)}`), false);
	});
});

describe("modelKey", () => {
	it("joins provider and id", () => {
		assert.equal(modelKey("anthropic", "claude-opus-4-6"), "anthropic/claude-opus-4-6");
	});
});

describe("parsePreferredThinkingConfig", () => {
	it("keeps valid mappings", () => {
		assert.deepEqual(
			asPlain(
				parsePreferredThinkingConfig({
					"anthropic/claude-opus-4-6": "high",
					"openai/gpt-5.2": "medium",
				}),
			),
			{
				"anthropic/claude-opus-4-6": "high",
				"openai/gpt-5.2": "medium",
			},
		);
	});

	it("drops invalid keys and levels", () => {
		assert.deepEqual(
			asPlain(
				parsePreferredThinkingConfig({
					"no-slash": "high",
					"": "low",
					"  ": "medium",
					"provider/id": "nope",
					"provider/ok": "low",
					nested: { a: 1 },
				}),
			),
			{ "provider/ok": "low" },
		);
	});

	it("drops prototype-pollution keys", () => {
		const raw = JSON.parse('{"__proto__":{"polluted":true},"a/b":"high","constructor/x":"low"}');
		const parsed = parsePreferredThinkingConfig(raw);
		assert.deepEqual(asPlain(parsed), { "a/b": "high" });
		assert.equal(Object.getPrototypeOf(parsed), null);
		assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
	});

	it("caps entry count", () => {
		const raw: Record<string, string> = {};
		for (let i = 0; i < MAX_CONFIG_ENTRIES + 50; i++) {
			raw[`p/model-${i}`] = "low";
		}
		const parsed = parsePreferredThinkingConfig(raw);
		assert.equal(Object.keys(parsed).length, MAX_CONFIG_ENTRIES);
	});

	it("returns empty for non-objects", () => {
		assert.deepEqual(asPlain(parsePreferredThinkingConfig(null)), {});
		assert.deepEqual(asPlain(parsePreferredThinkingConfig([])), {});
		assert.deepEqual(asPlain(parsePreferredThinkingConfig("x")), {});
	});

	it("trims keys", () => {
		assert.deepEqual(asPlain(parsePreferredThinkingConfig({ "  a/b  ": "max" })), { "a/b": "max" });
	});
});

describe("resolvePreferredLevel", () => {
	const map = parsePreferredThinkingConfig({ "anthropic/claude-opus-4-6": "high" });

	it("returns matching level", () => {
		assert.equal(resolvePreferredLevel(map, "anthropic", "claude-opus-4-6"), "high");
	});

	it("returns undefined for missing models", () => {
		assert.equal(resolvePreferredLevel(map, "openai", "gpt-5.2"), undefined);
	});

	it("returns undefined for invalid stored values", () => {
		assert.equal(resolvePreferredLevel({ "a/b": "nope" }, "a", "b"), undefined);
	});

	it("does not read inherited prototype properties", () => {
		const polluted = Object.create({ "evil/model": "high" });
		assert.equal(resolvePreferredLevel(polluted, "evil", "model"), undefined);
	});
});

describe("hasCliThinkingOverride", () => {
	it("detects --thinking forms", () => {
		assert.equal(hasCliThinkingOverride(["node", "pi", "--thinking", "high"]), true);
		assert.equal(hasCliThinkingOverride(["node", "pi", "--thinking=low"]), true);
	});

	it("detects model:thinking shorthand", () => {
		assert.equal(hasCliThinkingOverride(["node", "pi", "--model", "anthropic/claude:high"]), true);
		assert.equal(hasCliThinkingOverride(["node", "pi", "-m", "openai/gpt:medium"]), true);
		assert.equal(hasCliThinkingOverride(["node", "pi", "--model=anthropic/claude:max"]), true);
	});

	it("ignores plain model selection", () => {
		assert.equal(hasCliThinkingOverride(["node", "pi", "--model", "anthropic/claude"]), false);
		assert.equal(hasCliThinkingOverride(["node", "pi", "-m", "openai/gpt"]), false);
		assert.equal(hasCliThinkingOverride(["node", "pi"]), false);
	});
});

describe("shouldApplyOnSessionStart", () => {
	it("applies for startup/new without CLI thinking", () => {
		assert.equal(shouldApplyOnSessionStart("startup", ["pi"]), true);
		assert.equal(shouldApplyOnSessionStart("new", ["pi"]), true);
	});

	it("skips resume/fork/reload and CLI thinking", () => {
		assert.equal(shouldApplyOnSessionStart("resume", ["pi"]), false);
		assert.equal(shouldApplyOnSessionStart("fork", ["pi"]), false);
		assert.equal(shouldApplyOnSessionStart("reload", ["pi"]), false);
		assert.equal(shouldApplyOnSessionStart("startup", ["pi", "--thinking", "high"]), false);
	});
});

describe("shouldApplyOnModelSelect", () => {
	it("applies for set/cycle only", () => {
		assert.equal(shouldApplyOnModelSelect("set"), true);
		assert.equal(shouldApplyOnModelSelect("cycle"), true);
		assert.equal(shouldApplyOnModelSelect("restore"), false);
	});
});

describe("getAgentDir / getConfigPath", () => {
	it("defaults to ~/.pi/agent/extensions/preferred-thinking.json", () => {
		assert.equal(getAgentDir({}, () => "/home/u"), join("/home/u", ".pi", "agent"));
		assert.equal(
			getConfigPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "extensions", "preferred-thinking.json"),
		);
	});

	it("honors PI_CODING_AGENT_DIR and ~ expansion", () => {
		assert.equal(
			getConfigPath({ PI_CODING_AGENT_DIR: "~/custom-agent" }, () => "/home/u"),
			join("/home/u", "custom-agent", "extensions", "preferred-thinking.json"),
		);
		assert.equal(
			getConfigPath({ PI_CODING_AGENT_DIR: "/abs/agent" }, () => "/home/u"),
			join("/abs/agent", "extensions", "preferred-thinking.json"),
		);
	});
});

describe("formatPreferredThinkingHelp", () => {
	it("lists every subcommand, levels, and optional config path", () => {
		const help = formatPreferredThinkingHelp("/tmp/preferred-thinking.json");
		for (const cmd of SUBCOMMANDS) {
			assert.match(help, new RegExp(`\\b${cmd.name}\\b`));
			assert.match(help, new RegExp(cmd.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		}
		assert.match(help, /Levels: off, minimal, low, medium, high, xhigh, max/);
		assert.match(help, /Config: \/tmp\/preferred-thinking\.json/);
	});

	it("omits config line when path is not provided", () => {
		const help = formatPreferredThinkingHelp();
		assert.equal(help.includes("Config:"), false);
	});
});

describe("getPreferredThinkingArgumentCompletions", () => {
	it("completes subcommands for empty or partial first token", () => {
		const all = getPreferredThinkingArgumentCompletions("");
		assert.ok(all);
		assert.deepEqual(
			all.map((item) => item.value),
			SUBCOMMANDS.map((cmd) => cmd.name),
		);

		const filtered = getPreferredThinkingArgumentCompletions("re");
		assert.deepEqual(
			filtered?.map((item) => item.value),
			["reload"],
		);
	});

	it("completes thinking levels after set, preserving the set subcommand in value", () => {
		// Pi replaces the whole argument prefix with item.value, so values must be "set <level>".
		const levels = getPreferredThinkingArgumentCompletions("set ");
		assert.deepEqual(
			levels?.map((item) => item.value),
			VALID_THINKING_LEVELS.map((level) => `set ${level}`),
		);
		assert.deepEqual(
			levels?.map((item) => item.label),
			[...VALID_THINKING_LEVELS],
		);

		const filtered = getPreferredThinkingArgumentCompletions("set hi");
		assert.deepEqual(
			filtered?.map((item) => item.value),
			["set high"],
		);
		assert.deepEqual(
			filtered?.map((item) => item.label),
			["high"],
		);
	});

	it("returns null for unknown subcommands or exhausted tokens", () => {
		assert.equal(getPreferredThinkingArgumentCompletions("nope"), null);
		assert.equal(getPreferredThinkingArgumentCompletions("set high "), null);
		assert.equal(getPreferredThinkingArgumentCompletions("list "), null);
	});
});

describe("load/savePreferredThinkingConfig", () => {
	it("round-trips valid config and ignores missing files", () => {
		const dir = mkdtempSync(join(tmpdir(), "preferred-thinking-"));
		const path = join(dir, "extensions", "preferred-thinking.json");
		try {
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(path)), {});

			assert.equal(savePreferredThinkingConfig({ "a/b": "high", bad: "nope" }, path), true);
			const written = JSON.parse(readFileSync(path, "utf8"));
			assert.deepEqual(written, { "a/b": "high" });
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(path)), { "a/b": "high" });

			writeFileSync(path, "{not json", "utf8");
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(path)), {});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores oversized config files", () => {
		const dir = mkdtempSync(join(tmpdir(), "preferred-thinking-big-"));
		const path = join(dir, "preferred-thinking.json");
		try {
			writeFileSync(path, `${"x".repeat(MAX_CONFIG_BYTES + 1)}`, "utf8");
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(path)), {});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to load or overwrite symlink paths", () => {
		const dir = mkdtempSync(join(tmpdir(), "preferred-thinking-link-"));
		const target = join(dir, "target.json");
		const link = join(dir, "preferred-thinking.json");
		try {
			writeFileSync(target, JSON.stringify({ "a/b": "high" }), "utf8");
			symlinkSync(target, link);
			assert.equal(lstatSync(link).isSymbolicLink(), true);

			// Load must not follow the symlink.
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(link)), {});

			// Save must refuse to clobber a non-regular destination.
			assert.equal(savePreferredThinkingConfig({ "c/d": "low" }, link), false);
			assert.equal(lstatSync(link).isSymbolicLink(), true);
			assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { "a/b": "high" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes a regular file with owner-only mode when supported", () => {
		const dir = mkdtempSync(join(tmpdir(), "preferred-thinking-mode-"));
		const path = join(dir, "preferred-thinking.json");
		try {
			assert.equal(savePreferredThinkingConfig({ "a/b": "medium" }, path), true);
			const mode = lstatSync(path).mode & 0o777;
			// On POSIX, expect 0o600. Windows may report a different mask — only assert bits we care about when restrictive.
			if (process.platform !== "win32") {
				assert.equal(mode, 0o600);
			}
			assert.equal(lstatSync(path).isFile(), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
