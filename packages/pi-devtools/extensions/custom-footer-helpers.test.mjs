import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveFooterThinkingLevel,
	thinkingLevelColorToken,
	THINKING_LEVEL_COLORS,
} from "./custom-footer-helpers.mjs";

/**
 * Old footer policy: hard-code "high", only update on thinking_level_select.
 * New sessions never emit that event when the level is already set, so this
 * stays wrong. Kept here so the feedback loop remains red-capable against the bug.
 */
function oldFooterThinkingLevelOnSessionStart(_getThinkingLevel) {
	return "high";
}

describe("resolveFooterThinkingLevel", () => {
	it("uses the live session level on new sessions (no thinking_level_select)", () => {
		// Symptom: selected/default level is medium; no change event fires.
		const live = "medium";
		const getLive = () => live;

		// Old policy reproduces the user-reported bug.
		assert.equal(oldFooterThinkingLevelOnSessionStart(getLive), "high");
		assert.notEqual(oldFooterThinkingLevelOnSessionStart(getLive), live);

		// Fixed policy must show the selected level immediately.
		assert.equal(resolveFooterThinkingLevel(getLive), "medium");
		assert.notEqual(resolveFooterThinkingLevel(getLive), "high");
	});

	it("tracks whatever getThinkingLevel returns after a change", () => {
		let live = "low";
		assert.equal(
			resolveFooterThinkingLevel(() => live),
			"low",
		);
		live = "xhigh";
		assert.equal(
			resolveFooterThinkingLevel(() => live),
			"xhigh",
		);
	});

	it("falls back to off for empty values", () => {
		assert.equal(
			resolveFooterThinkingLevel(() => ""),
			"off",
		);
		assert.equal(
			resolveFooterThinkingLevel(() => undefined),
			"off",
		);
	});
});

describe("thinkingLevelColorToken", () => {
	it("maps every pi thinking level", () => {
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
			assert.ok(THINKING_LEVEL_COLORS[level], `missing color for ${level}`);
			assert.equal(thinkingLevelColorToken(level), THINKING_LEVEL_COLORS[level]);
		}
	});

	it("does not use the obsolete extra-high key", () => {
		assert.equal(THINKING_LEVEL_COLORS["extra-high"], undefined);
		assert.equal(thinkingLevelColorToken("xhigh"), "thinkingXhigh");
	});

	it("falls back to accent for unknown levels", () => {
		assert.equal(thinkingLevelColorToken("nope"), "accent");
	});
});
