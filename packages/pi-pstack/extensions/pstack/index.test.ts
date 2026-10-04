import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, parseConfig } from "./config.ts";
import { systemPromptInjection } from "./index.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const SLUG_CONFIG = parseConfig({
	version: 1,
	roles: { "bug-fix": "anthropic/claude-opus-4-6" },
});

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode one-liner when the mode is on", () => {
		assert.equal(systemPromptInjection(defaultConfig(), true), POTETO_ONE_LINER);
	});

	it("injects no Poteto Mode text when the mode is off", () => {
		assert.equal(systemPromptInjection(defaultConfig(), false), "");
		assert.equal(systemPromptInjection(SLUG_CONFIG, false), "bug-fix: anthropic/claude-opus-4-6");
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, true),
			`bug-fix: anthropic/claude-opus-4-6\n\n${POTETO_ONE_LINER}`,
		);
	});
});
