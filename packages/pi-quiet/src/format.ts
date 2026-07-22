/**
 * Quiet Row string builders (no TUI / theme dependency).
 * The extension applies theme colors around these plain strings.
 */

import type { QuietOutcome } from "./classify.ts";
import type { QuietToolName } from "./tools-meta.ts";
import { FOREIGN_KIND_EMOJI, isQuietToolName } from "./tools-meta.ts";

/** Last N lines shown on Hard Breakthrough auto-expand. */
export const HARD_FAILURE_TAIL_LINES = 12;

/** Max visible characters for bash command on the call line. */
export const MAX_COMMAND_DISPLAY = 80;

/** Max visible characters for a Foreign Tool arg peek. */
export const MAX_ARG_PEEK_DISPLAY = 60;

/** Kind Emoji for Quiet built-ins (singleton rows + Group Headers). */
export const KIND_EMOJI: Record<QuietToolName, string> = {
	read: "📖",
	bash: "💻",
	edit: "✏️",
	write: "📝",
	grep: "🔍",
	find: "🔎",
	ls: "📂",
};

/** Priority arg keys for Generic Kind Formatter peeks. */
export const ARG_PEEK_PRIORITY_KEYS = [
	"tool",
	"name",
	"path",
	"query",
	"command",
	"pattern",
	"id",
	"url",
	"message",
	"prompt",
] as const;

export function kindEmoji(tool: string): string {
	if (isQuietToolName(tool)) return KIND_EMOJI[tool];
	if (!tool) return "";
	return FOREIGN_KIND_EMOJI;
}

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

/** True when an arg key looks secret-bearing and must not appear in peeks. */
export function isSecretArgKey(key: string): boolean {
	const n = key.toLowerCase();
	if (
		n === "token" ||
		n === "key" ||
		n === "secret" ||
		n === "password" ||
		n === "authorization" ||
		n === "cookie" ||
		n === "auth" ||
		n === "api_key" ||
		n === "apikey"
	) {
		return true;
	}
	if (n.endsWith("_token") || n.endsWith("_secret") || n.endsWith("_password")) return true;
	if (n.endsWith("_key") || n.includes("password") || n.includes("secret")) return true;
	if (n.includes("token") || n.includes("authorization") || n.includes("cookie")) return true;
	return false;
}

function formatPeekValue(value: unknown, home: string): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.replace(/\s+/g, " ").trim();
		if (!trimmed) return undefined;
		const shortened =
			trimmed.startsWith("/") || trimmed.startsWith("~") || (home && trimmed.startsWith(home))
				? shortenPath(trimmed, home)
				: trimmed;
		return truncateMiddle(shortened, MAX_ARG_PEEK_DISPLAY);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return truncateMiddle(String(value), MAX_ARG_PEEK_DISPLAY);
	}
	return undefined;
}

/**
 * Short arg peek for the Generic Kind Formatter.
 * Priority keys first, else first safe top-level stringish value.
 */
export function formatArgPeek(args: CallArgs, home: string): string | undefined {
	for (const key of ARG_PEEK_PRIORITY_KEYS) {
		if (!(key in args) || isSecretArgKey(key)) continue;
		const peek = formatPeekValue(args[key], home);
		if (peek !== undefined) return peek;
	}
	// Prefer string fields, then number/boolean, so counts like `limit` do not hide labels.
	let fallback: string | undefined;
	for (const [key, value] of Object.entries(args)) {
		if (isSecretArgKey(key)) continue;
		if (typeof value === "string") {
			const peek = formatPeekValue(value, home);
			if (peek !== undefined) return peek;
			continue;
		}
		if (fallback === undefined) {
			fallback = formatPeekValue(value, home);
		}
	}
	return fallback;
}

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
		default: {
			const peek = formatArgPeek(args, home);
			return peek ? `${tool} ${peek}` : tool;
		}
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

/** Singleton Quiet Row call line: Kind Emoji + call summary. */
export function formatSingletonCallLine(
	tool: string,
	args: CallArgs,
	home: string,
): string {
	const emoji = kindEmoji(tool);
	const summary = formatCallSummary(tool, args, home);
	return emoji ? `${emoji} ${summary}` : summary;
}

/** Group Header: Kind Emoji + kind ×N. */
export function formatGroupHeader(tool: string, count: number): string {
	const emoji = kindEmoji(tool);
	const label = `${tool} ×${count}`;
	return emoji ? `${emoji} ${label}` : label;
}

/**
 * Member Bullet summary fragment with the tool name stripped
 * (the Group Header already names the kind).
 */
export function formatMemberSummary(
	tool: string,
	args: CallArgs,
	home: string,
): string {
	const full = formatCallSummary(tool, args, home);
	switch (tool) {
		case "bash":
			return full; // already `$ cmd`
		case "read":
			return full.replace(/^read\s+/, "");
		case "edit":
			return full.replace(/^edit\s+/, "");
		case "write":
			return full.replace(/^write\s+/, "");
		case "grep":
			return full.replace(/^grep\s+/, "");
		case "find":
			return full.replace(/^find\s+/, "");
		case "ls":
			return full.replace(/^ls\s+/, "");
		default: {
			// Foreign: header already names the tool; bullet is arg peek, or a placeholder if none.
			return formatArgPeek(args, home) ?? "…";
		}
	}
}

/** One Member Bullet under a Group Header. */
export function formatMemberBullet(summary: string, chip?: string): string {
	if (chip) return `  • ${summary} · ${chip}`;
	return `  • ${summary}`;
}
