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
 * @returns {"accent" | "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh"}
 */
export function thinkingLevelColorToken(level) {
	return THINKING_LEVEL_COLORS[level] || "accent";
}

/**
 * @typedef {{ input: number, output: number, cost: number, reasoning: number, cacheRead: number, cacheWrite: number }} FooterUsageTotals
 */

/** @returns {FooterUsageTotals} */
export function emptyFooterUsageTotals() {
	return { input: 0, output: 0, cost: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
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
		cacheRead: totals.cacheRead + asNumber(usage?.cacheRead),
		cacheWrite: totals.cacheWrite + asNumber(usage?.cacheWrite),
		cost: totals.cost + asNumber(usage?.cost?.total),
		reasoning: totals.reasoning + asNumber(usage?.reasoning),
	};
}

/**
 * Latest-response cache hit rate as a percentage, or null when not computable.
 *
 * Matches the built-in footer's definition: cacheRead / (input + cacheRead +
 * cacheWrite) * 100. Returns null when the denominator is <= 0.
 *
 * @param {any} message  // AssistantMessage-like with usage fields
 * @returns {number | null}
 */
export function latestCacheHitRate(message) {
	const usage = message?.usage;
	const denom = asNumber(usage?.input) + asNumber(usage?.cacheRead) + asNumber(usage?.cacheWrite);
	if (denom <= 0) return null;
	return (asNumber(usage?.cacheRead) / denom) * 100;
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

/**
 * Remove ANSI escape sequences (CSI, OSC, APC) from a string, mirroring the
 * set pi-tui strips when measuring visible width. Returns the input unchanged
 * when it contains no ESC byte.
 *
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
	if (!text.includes("\x1b")) return text;
	let out = "";
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\x1b") {
			const next = text[i + 1];
			// CSI: ESC [ ... final byte (m/G/K/H/J, same set as pi-tui)
			if (next === "[") {
				let j = i + 2;
				while (j < text.length && !/[mGKHJ]/.test(text[j])) j++;
				if (j < text.length) {
					i = j + 1;
					continue;
				}
			} else if (next === "]" || next === "_") {
				// OSC (ESC ] ... BEL|ST) / APC (ESC _ ... BEL|ST)
				let j = i + 2;
				while (j < text.length) {
					if (text[j] === "\x07") break;
					if (text[j] === "\x1b" && text[j + 1] === "\\") {
						j++;
						break;
					}
					j++;
				}
				if (j < text.length) {
					i = j + 1;
					continue;
				}
			}
		}
		out += text[i];
		i++;
	}
	return out;
}

/**
 * Terminal display width of a single code point: 0 for zero-width characters
 * (combining marks, joiners, variation selectors), 2 for East Asian wide /
 * fullwidth forms and emoji, 1 otherwise. Same classification as the
 * string-width-derived table pi-tui uses.
 *
 * @param {number} cp
 * @returns {number}
 */
function codePointWidth(cp) {
	if (
		cp === 0x00ad || // soft hyphen
		(cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
		(cp >= 0x200b && cp <= 0x200f) || // zero-width space .. right-to-left mark
		(cp >= 0x2028 && cp <= 0x202e) || // line/paragraph separators, LR embeddings
		(cp >= 0x2060 && cp <= 0x2064) || // word joiner .. invisible plus
		(cp >= 0x2066 && cp <= 0x206f) || // isolate marks
		cp === 0xfe0f || // variation selector-16 (emoji presentation)
		(cp >= 0xfe20 && cp <= 0xfe2f) // combining half marks
	) {
		return 0;
	}
	if (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals .. CJK symbols
		(cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK compatibility
		(cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
		(cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
		(cp >= 0xa000 && cp <= 0xa4cf) || // Yi syllables
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
		(cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
		(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
		(cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
		(cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
		(cp >= 0x1f1e6 && cp <= 0x1f1ff) || // regional indicators
		(cp >= 0x1f300 && cp <= 0x1f64f) || // misc symbols and pictographs
		(cp >= 0x1f900 && cp <= 0x1f9ff) || // supplemental symbols and pictographs
		(cp >= 0x1fa70 && cp <= 0x1faff) // symbols and pictographs extended-A
	) {
		return 2;
	}
	return 1;
}

/**
 * Measure the terminal display width of a string (in columns), mirroring
 * pi-tui's visibleWidth for the character classes the footer renders:
 * - ANSI escape sequences count as 0 columns
 * - tabs count as 3 columns (matching pi-tui)
 * - East Asian wide/fullwidth code points and emoji count as 2
 * - zero-width code points (combining marks, joiners, VS16) count as 0
 * - everything else counts as 1
 *
 * Kept local so the pure helpers keep zero runtime dependencies: pi-tui is a
 * peer dependency that the test runner cannot resolve (node --test has no
 * access to the pi host's node_modules).
 *
 * @param {string} text
 * @returns {number}
 */
export function displayWidth(text) {
	if (text.length === 0) return 0;
	const clean = text.includes("\t") ? text.replace(/\t/g, "   ") : text;
	let width = 0;
	for (const char of stripAnsi(clean)) {
		width += codePointWidth(char.codePointAt(0));
	}
	return width;
}

/**
 * Drop lowest-priority trailing parts from a left-parts array until its
 * visible width (joined by `sep`) fits `budget`. Parts before `keepFrom`
 * (0-indexed) are always-preserved anchors and are never dropped; with
 * `keepFrom === 0` every part is droppable. When only anchors remain and
 * they still exceed the budget, the anchored prefix is returned unchanged -
 * the caller end-truncates it with an ellipsis.
 *
 * @param {string[]} parts  // already-joined-with-sep-safe single strings
 * @param {string} sep       // separator used to join visible parts
 * @param {number} budget    // max visible width for the joined left, >= 0
 * @param {number} keepFrom  // count of leading parts to always keep (default 0)
 * @returns {string[]}       // prefix of `parts`, order preserved
 */
export function trimLeftParts(parts, sep, budget, keepFrom = 0) {
	const sepWidth = displayWidth(sep);
	const widths = parts.map((part) => displayWidth(part));
	let count = parts.length;
	let joinedWidth = widths.reduce((a, b) => a + b, 0) + (count > 1 ? (count - 1) * sepWidth : 0);
	// Drop trailing (lowest-priority) parts until the joined line fits the
	// budget or only the anchors remain. `count` strictly decreases, so the
	// loop is bounded and cannot spin forever.
	while (count > keepFrom && joinedWidth > budget) {
		count -= 1;
		joinedWidth -= widths[count];
		if (count > 0) joinedWidth -= sepWidth;
	}
	return parts.slice(0, count);
}
