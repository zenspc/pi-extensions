import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addAssistantUsage,
	displayWidth,
	emptyFooterUsageTotals,
	latestCacheHitRate,
	resolveFooterThinkingLevel,
	sumAssistantUsageFromBranch,
	thinkingLevelColorToken,
	THINKING_LEVEL_COLORS,
	trimLeftParts,
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

function assistantEntry(usage) {
	return {
		type: "message",
		message: {
			role: "assistant",
			usage,
		},
	};
}

describe("emptyFooterUsageTotals", () => {
	it("returns all zeros", () => {
		assert.deepEqual(emptyFooterUsageTotals(), {
			input: 0,
			output: 0,
			cost: 0,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});
});

describe("sumAssistantUsageFromBranch", () => {
	it("returns zeros for an empty branch", () => {
		assert.deepEqual(sumAssistantUsageFromBranch([]), emptyFooterUsageTotals());
	});

	it("sums one assistant message exactly", () => {
		const branch = [
			assistantEntry({
				input: 100,
				output: 50,
				cost: { total: 0.012 },
				reasoning: 20,
				cacheRead: 7,
				cacheWrite: 3,
			}),
		];
		assert.deepEqual(sumAssistantUsageFromBranch(branch), {
			input: 100,
			output: 50,
			cost: 0.012,
			reasoning: 20,
			cacheRead: 7,
			cacheWrite: 3,
		});
	});

	it("ignores user and tool messages", () => {
		const branch = [
			{ type: "message", message: { role: "user", content: "hi" } },
			assistantEntry({
				input: 10,
				output: 5,
				cost: { total: 0.001 },
				reasoning: 2,
				cacheRead: 4,
				cacheWrite: 2,
			}),
			{ type: "message", message: { role: "toolResult", content: "ok" } },
			{ type: "compaction", summary: "x" },
		];
		assert.deepEqual(sumAssistantUsageFromBranch(branch), {
			input: 10,
			output: 5,
			cost: 0.001,
			reasoning: 2,
			cacheRead: 4,
			cacheWrite: 2,
		});
	});

	it("treats missing reasoning as 0", () => {
		const branch = [
			assistantEntry({
				input: 1,
				output: 2,
				cost: { total: 0.5 },
			}),
		];
		assert.deepEqual(sumAssistantUsageFromBranch(branch), {
			input: 1,
			output: 2,
			cost: 0.5,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
	});

	it("does not throw on malformed entries without usage", () => {
		const branch = [
			{ type: "message", message: { role: "assistant" } },
			{ type: "message", message: { role: "assistant", usage: null } },
			{
				type: "message",
				message: { role: "assistant", usage: { cost: {} } },
			},
		];
		assert.deepEqual(sumAssistantUsageFromBranch(branch), emptyFooterUsageTotals());
	});
});

describe("addAssistantUsage", () => {
	it("matches sum of two assistant messages", () => {
		const m1 = {
			role: "assistant",
			usage: {
				input: 100,
				output: 40,
				cost: { total: 0.01 },
				reasoning: 5,
				cacheRead: 7,
				cacheWrite: 3,
			},
		};
		const m2 = {
			role: "assistant",
			usage: {
				input: 200,
				output: 60,
				cost: { total: 0.02 },
				reasoning: 15,
				cacheRead: 12,
				cacheWrite: 5,
			},
		};
		const folded = addAssistantUsage(addAssistantUsage(emptyFooterUsageTotals(), m1), m2);
		const summed = sumAssistantUsageFromBranch([
			{ type: "message", message: m1 },
			{ type: "message", message: m2 },
		]);
		assert.deepEqual(folded, summed);
		assert.deepEqual(folded, {
			input: 300,
			output: 100,
			cost: 0.03,
			reasoning: 20,
			cacheRead: 19,
			cacheWrite: 8,
		});
	});

	it("ignores the obsolete reasoning-token field name", () => {
		// Regression: the footer previously read a reasoning-tokens field that
		// does not exist on the real Usage shape (the field is usage.reasoning).
		// The old name is built dynamically so the literal cannot be mistaken
		// for a live usage read in grep audits.
		const oldFieldName = "reasoning" + "Tokens";
		const totals = addAssistantUsage(emptyFooterUsageTotals(), {
			role: "assistant",
			usage: { [oldFieldName]: 99, reasoning: 5 },
		});
		assert.equal(totals.reasoning, 5);
		assert.notEqual(totals.reasoning, 99);
	});
});

describe("displayWidth", () => {
	it("counts plain ASCII by character", () => {
		assert.equal(displayWidth("↑ 12.3k"), 7);
	});

	it("ignores ANSI escape sequences", () => {
		assert.equal(displayWidth("\x1b[32mabc\x1b[0m"), 3);
	});

	it("counts East Asian wide characters as two columns", () => {
		assert.equal(displayWidth("中文"), 4);
	});

	it("expands tabs to three columns", () => {
		assert.equal(displayWidth("a\tb"), 5);
	});

	it("counts zero-width characters as zero", () => {
		assert.equal(displayWidth("e\u0301"), 1); // e + combining acute
		assert.equal(displayWidth("a\u200db"), 2); // ZWJ between two letters
	});

	it("returns 0 for the empty string", () => {
		assert.equal(displayWidth(""), 0);
	});
});

describe("trimLeftParts", () => {
	it("returns parts unchanged when everything fits", () => {
		assert.deepEqual(trimLeftParts(["↑1", "↓2", "CH90%"], " | ", 20), ["↑1", "↓2", "CH90%"]);
	});

	it("drops only the last part when one extra", () => {
		assert.deepEqual(trimLeftParts(["aa", "bb", "cc"], " ", 6), ["aa", "bb"]);
	});

	it("drops from the end until it fits", () => {
		assert.deepEqual(trimLeftParts(["aa", "bb", "cc", "dd"], " ", 5), ["aa", "bb"]);
	});

	it("keeps the anchored prefix even when it exceeds the budget (keepFrom=2)", () => {
		assert.deepEqual(trimLeftParts(["a", "b", "c", "d"], " ", 1, 2), ["a", "b"]);
	});

	it("returns [] for empty parts", () => {
		assert.deepEqual(trimLeftParts([], " | ", 10), []);
	});

	it("drops the only part at budget 0 when it is droppable (default keepFrom=0)", () => {
		assert.deepEqual(trimLeftParts(["xx"], " | ", 0), []);
	});

	it("keeps a single anchor part as-is at budget 0 (keepFrom=1)", () => {
		assert.deepEqual(trimLeftParts(["xx"], " | ", 0, 1), ["xx"]);
	});

	it("drops trailing parts by index, not value (duplicate parts)", () => {
		assert.deepEqual(trimLeftParts(["x", "x", "x"], " ", 1), ["x"]);
	});

	it("is a no-op when keepFrom equals parts.length", () => {
		assert.deepEqual(trimLeftParts(["a", "b"], " ", 0, 2), ["a", "b"]);
	});
});

describe("latestCacheHitRate", () => {
	it("returns null when usage is missing or empty", () => {
		assert.equal(latestCacheHitRate({}), null);
		assert.equal(latestCacheHitRate({ usage: {} }), null);
		assert.equal(latestCacheHitRate(null), null);
	});

	it("returns null when input + cacheRead + cacheWrite is 0", () => {
		assert.equal(latestCacheHitRate({ usage: { input: 0, cacheRead: 0, cacheWrite: 0 } }), null);
	});

	it("computes the exact percentage for a known input", () => {
		assert.equal(
			latestCacheHitRate({ usage: { input: 10, cacheRead: 90, cacheWrite: 0 } }),
			90.0,
		);
	});

	it("uses all three terms in the denominator", () => {
		assert.equal(
			latestCacheHitRate({ usage: { input: 25, cacheRead: 50, cacheWrite: 25 } }),
			50.0,
		);
	});
});
