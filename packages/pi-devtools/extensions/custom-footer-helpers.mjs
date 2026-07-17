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
