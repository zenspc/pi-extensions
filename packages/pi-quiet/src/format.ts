/**
 * Quiet Row string builders (no TUI / theme dependency).
 * The extension applies theme colors around these plain strings.
 */

import type { QuietOutcome } from "./classify.ts";

/** Last N lines shown on Hard Breakthrough auto-expand. */
export const HARD_FAILURE_TAIL_LINES = 12;

/** Max visible characters for bash command on the call line. */
export const MAX_COMMAND_DISPLAY = 80;

export function shortenPath(path: string, home: string): string {
	if (!path) return path;
	if (home && (path === home || path.startsWith(`${home}/`))) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

function truncateMiddle(text: string, max: number): string {
	if (text.length <= max) return text;
	if (max <= 3) return text.slice(0, max);
	return `${text.slice(0, max - 3)}...`;
}

export type CallArgs = Record<string, unknown>;

export function formatCallSummary(
	tool: string,
	args: CallArgs,
	home: string,
): string {
	switch (tool) {
		case "bash": {
			const command = typeof args.command === "string" ? args.command : "...";
			return `$ ${truncateMiddle(command.replace(/\s+/g, " ").trim(), MAX_COMMAND_DISPLAY)}`;
		}
		case "read": {
			const path = shortenPath(typeof args.path === "string" ? args.path : "", home);
			let s = `read ${path || "..."}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const start = typeof args.offset === "number" ? args.offset : 1;
				if (typeof args.limit === "number") {
					s += `:${start}-${start + args.limit - 1}`;
				} else {
					s += `:${start}`;
				}
			}
			return s;
		}
		case "edit":
			return `edit ${shortenPath(typeof args.path === "string" ? args.path : "", home) || "..."}`;
		case "write":
			return `write ${shortenPath(typeof args.path === "string" ? args.path : "", home) || "..."}`;
		case "grep": {
			const pattern = typeof args.pattern === "string" ? args.pattern : "";
			const path = shortenPath(
				typeof args.path === "string" ? args.path : ".",
				home,
			);
			return `grep /${pattern}/ in ${path}`;
		}
		case "find": {
			const pattern = typeof args.pattern === "string" ? args.pattern : "";
			const path = shortenPath(
				typeof args.path === "string" ? args.path : ".",
				home,
			);
			return `find ${pattern} in ${path}`;
		}
		case "ls": {
			const path = shortenPath(
				typeof args.path === "string" ? args.path : ".",
				home,
			);
			return `ls ${path}`;
		}
		default:
			return tool;
	}
}

export function capFailureTail(
	text: string,
	maxLines: number = HARD_FAILURE_TAIL_LINES,
): string {
	const lines = text.replace(/\s+$/u, "").split("\n");
	if (lines.length <= maxLines) return lines.join("\n");
	return lines.slice(-maxLines).join("\n");
}

/**
 * Collapsed Quiet result lines (plain text).
 * Expanded success/stock body is handled by the renderer, not here.
 * Hard breakthrough always includes chip; when expanded (or auto-breakthrough
 * treated as expanded), append capped tail from body.
 */
export function formatQuietResultLines(
	outcome: QuietOutcome,
	expanded: boolean,
): string[] {
	if (outcome.kind === "pending") return ["…"];

	const chip = outcome.chip ? `· ${outcome.chip}` : "·";
	if (outcome.kind === "hard" && expanded && outcome.body) {
		const tail = capFailureTail(outcome.body);
		return [chip, ...tail.split("\n")];
	}
	return [chip];
}
