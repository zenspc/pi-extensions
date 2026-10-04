/**
 * Pure scroll helpers for /context overlays.
 * No pi-tui dependency so unit tests can import this module directly.
 */

/**
 * @param {number} offset
 * @param {number} contentLines
 * @param {number} viewportLines
 * @returns {number}
 */
export function clampScrollOffset(offset, contentLines, viewportLines) {
	const maxScroll = Math.max(0, contentLines - Math.max(1, viewportLines));
	if (!Number.isFinite(offset)) return 0;
	return Math.max(0, Math.min(Math.trunc(offset), maxScroll));
}

/**
 * @typedef {{ type: "delta", lines: number } | { type: "home" } | { type: "end" }} ScrollAction
 */

/**
 * Map keyboard input to a scroll action.
 * `matchesKey` is optional (pi-tui); plain-letter and common CSI sequences always work.
 *
 * @param {string} data
 * @param {number} pageSize
 * @param {(data: string, key: string) => boolean} [matchesKey]
 * @returns {ScrollAction | null}
 */
export function scrollActionForInput(data, pageSize, matchesKey) {
	const page = Math.max(1, Math.trunc(pageSize) || 1);
	const match = (key) => (typeof matchesKey === "function" ? matchesKey(data, key) : false);

	if (match("up") || match("ctrl+p") || data === "k" || data === "K" || data === "\x10" || data === "\x1b[A" || data === "\x1bOA") {
		return { type: "delta", lines: -1 };
	}
	if (match("down") || match("ctrl+n") || data === "j" || data === "J" || data === "\x0e" || data === "\x1b[B" || data === "\x1bOB") {
		return { type: "delta", lines: 1 };
	}
	if (match("pageUp") || match("alt+v") || data === "\x1b[5~") {
		return { type: "delta", lines: -page };
	}
	if (match("pageDown") || match("ctrl+v") || data === "\x1b[6~") {
		return { type: "delta", lines: page };
	}
	if (match("home") || data === "g" || data === "\x1b[H" || data === "\x1b[1~" || data === "\x1bOH") {
		return { type: "home" };
	}
	if (match("end") || data === "G" || data === "\x1b[F" || data === "\x1b[4~" || data === "\x1bOF") {
		return { type: "end" };
	}
	return null;
}

/**
 * @param {ScrollAction} action
 * @param {number} currentOffset
 * @param {number} contentLines
 * @param {number} viewportLines
 * @returns {number}
 */
export function applyScrollAction(action, currentOffset, contentLines, viewportLines) {
	const maxScroll = Math.max(0, contentLines - Math.max(1, viewportLines));
	if (action.type === "home") return 0;
	if (action.type === "end") return maxScroll;
	return clampScrollOffset(currentOffset + action.lines, contentLines, viewportLines);
}

/**
 * @param {number} offset
 * @param {number} viewport
 * @param {number} total
 * @returns {string}
 */
export function scrollRangeLabel(offset, viewport, total) {
	if (total <= 0) return "0/0";
	const start = Math.min(total, offset + 1);
	const end = Math.min(total, offset + viewport);
	return `${start}-${end}/${total}`;
}
