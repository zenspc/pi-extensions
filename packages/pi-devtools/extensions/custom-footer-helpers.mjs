/** Theme token names for each pi thinking level. */
export const THINKING_LEVEL_COLORS = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingXhigh",
};

/**
 * Resolve the thinking level shown in the custom footer.
 *
 * Must come from the live session (`pi.getThinkingLevel()`), never a hard-coded
 * default like "high". Pi only emits `thinking_level_select` on actual changes,
 * so a cached startup default stays wrong until the user cycles effort.
 *
 * @param {() => string} getThinkingLevel
 * @returns {string}
 */
export function resolveFooterThinkingLevel(getThinkingLevel) {
	const level = getThinkingLevel();
	return typeof level === "string" && level.length > 0 ? level : "off";
}

/**
 * @param {string} level
 * @returns {string}
 */
export function thinkingLevelColorToken(level) {
	return THINKING_LEVEL_COLORS[level] || "accent";
}

/**
 * @typedef {{ input: number, output: number, cost: number, reasoning: number }} FooterUsageTotals
 */

/** @returns {FooterUsageTotals} */
export function emptyFooterUsageTotals() {
	return { input: 0, output: 0, cost: 0, reasoning: 0 };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Add one assistant message's usage into totals (pure; returns a new object).
 * @param {FooterUsageTotals} totals
 * @param {any} message
 * @returns {FooterUsageTotals}
 */
export function addAssistantUsage(totals, message) {
	const usage = message?.usage;
	return {
		input: totals.input + asNumber(usage?.input),
		output: totals.output + asNumber(usage?.output),
		cost: totals.cost + asNumber(usage?.cost?.total),
		reasoning: totals.reasoning + asNumber(usage?.reasoningTokens),
	};
}

/**
 * Sum assistant message usage from a session branch-like array.
 * @param {Iterable<any>} branch
 * @returns {FooterUsageTotals}
 */
export function sumAssistantUsageFromBranch(branch) {
	let totals = emptyFooterUsageTotals();
	for (const entry of branch) {
		if (entry?.type === "message" && entry?.message?.role === "assistant") {
			totals = addAssistantUsage(totals, entry.message);
		}
	}
	return totals;
}
