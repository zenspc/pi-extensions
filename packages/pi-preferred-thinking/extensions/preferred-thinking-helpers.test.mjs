import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	getAgentDir,
	getConfigPath,
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
	VALID_THINKING_LEVELS,
} from "./preferred-thinking-helpers.mjs";

function asPlain(map) {
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
		assert.equal(Object.prototype.polluted, undefined);
	});

	it("caps entry count", () => {
		/** @type {Record<string, string>} */
		const raw = {};
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

describe("load/savePreferredThinkingConfig", () => {
	it("round-trips valid config and ignores missing files", () => {
		const dir = mkdtempSync(join(tmpdir(), "preferred-thinking-"));
		const path = join(dir, "extensions", "preferred-thinking.json");
		try {
			assert.deepEqual(asPlain(loadPreferredThinkingConfig(path)), {});

			savePreferredThinkingConfig({ "a/b": "high", bad: "nope" }, path);
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
});
