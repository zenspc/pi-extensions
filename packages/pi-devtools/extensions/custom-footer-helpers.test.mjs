import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addRecordedUsage,
	emptyFooterUsageTotals,
	resolveFooterThinkingLevel,
	sumRecordedUsage,
	thinkingLevelColorToken,
	THINKING_LEVEL_COLORS,
} from "./custom-footer-helpers.mjs";

describe("resolveFooterThinkingLevel", () => {
	it("uses the live session level on new sessions without a change event", () => {
		assert.equal(resolveFooterThinkingLevel(() => "medium"), "medium");
	});

	it("tracks whatever getThinkingLevel returns after a change", () => {
		let live = "low";
		assert.equal(resolveFooterThinkingLevel(() => live), "low");
		live = "xhigh";
		assert.equal(resolveFooterThinkingLevel(() => live), "xhigh");
	});

	it("falls back to off for empty values", () => {
		assert.equal(resolveFooterThinkingLevel(() => ""), "off");
		assert.equal(resolveFooterThinkingLevel(() => undefined), "off");
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

const usage = { input: 100, output: 50, cost: { total: 0.125 }, reasoningTokens: 20 };
const totals = { input: 100, output: 50, cost: 0.125, reasoning: 20 };
const assistantEntry = (value) => ({ type: "message", message: { role: "assistant", usage: value } });

describe("emptyFooterUsageTotals", () => {
	it("returns all zeros", () => {
		assert.deepEqual(emptyFooterUsageTotals(), { input: 0, output: 0, cost: 0, reasoning: 0 });
	});
});

describe("sumRecordedUsage", () => {
	it("returns zeros for empty history", () => {
		assert.deepEqual(sumRecordedUsage([]), emptyFooterUsageTotals());
	});

	it("sums one assistant message exactly", () => {
		assert.deepEqual(sumRecordedUsage([assistantEntry(usage)]), totals);
	});

	it("includes every recorded usage source, regardless of standalone kind", () => {
		const entries = [
			assistantEntry(usage),
			{ type: "message", message: { role: "toolResult", usage } },
			{ type: "usage", kind: "future-kind", usage },
			{ type: "compaction", usage },
			{ type: "branch_summary", usage },
		];
		assert.deepEqual(sumRecordedUsage(entries), { input: 500, output: 250, cost: 0.625, reasoning: 100 });
	});

	it("ignores user messages, metadata, and nested detail usage already in the parent result", () => {
		const entries = [
			{ type: "message", message: { role: "user", usage } },
			{ type: "custom", usage },
			{ type: "message", message: { role: "toolResult", usage, details: { nested: [{ usage }] } } },
		];
		assert.deepEqual(sumRecordedUsage(entries), totals);
	});

	it("treats missing reasoningTokens as zero", () => {
		assert.deepEqual(sumRecordedUsage([assistantEntry({ input: 1, output: 2, cost: { total: 0.5 } })]),
			{ input: 1, output: 2, cost: 0.5, reasoning: 0 });
	});

	it("tolerates malformed and missing usage", () => {
		assert.deepEqual(sumRecordedUsage([
			null, {}, assistantEntry(undefined), assistantEntry(null), assistantEntry({ cost: {} }),
			assistantEntry({ input: NaN, output: Infinity, cost: { total: "bad" } }),
			{ type: "compaction" }, { type: "message" },
		]), emptyFooterUsageTotals());
	});
});

describe("addRecordedUsage", () => {
	it("matches rebuilt totals without mutating its input", () => {
		const empty = emptyFooterUsageTotals();
		const folded = addRecordedUsage(addRecordedUsage(empty, { usage }), { usage });
		assert.deepEqual(folded, sumRecordedUsage([assistantEntry(usage), { type: "usage", usage }]));
		assert.deepEqual(folded, { input: 200, output: 100, cost: 0.25, reasoning: 40 });
		assert.deepEqual(empty, emptyFooterUsageTotals());
	});
});
