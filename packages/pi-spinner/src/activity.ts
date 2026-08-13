/**
 * Pure formatter for opt-in live activity messages.
 *
 * Tool names and args are untrusted (model / repo). Every fragment that
 * reaches the TUI goes through sanitizeMessage first.
 */

import { sanitizeMessage } from "./config.ts";

const PEEK_MAX = 40;
const GENERIC_KEYS = ["path", "file_path", "command", "pattern", "query", "name"] as const;

function capPeek(raw: unknown): string | undefined {
	const cleaned = sanitizeMessage(raw);
	if (!cleaned) return undefined;
	return cleaned.length > PEEK_MAX ? cleaned.slice(0, PEEK_MAX) : cleaned;
}

function lastSegment(path: string): string {
	const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const seg = i >= 0 ? path.slice(i + 1) : path;
	return seg || path;
}

function pathPeek(args: Record<string, unknown> | undefined): string | undefined {
	const cleaned = sanitizeMessage(args?.path) ?? sanitizeMessage(args?.file_path);
	if (!cleaned) return undefined;
	const base = lastSegment(cleaned);
	return base.length > PEEK_MAX ? base.slice(0, PEEK_MAX) : base;
}

function searchPeek(args: Record<string, unknown> | undefined): string | undefined {
	return capPeek(args?.pattern ?? args?.query);
}

function bashPeek(args: Record<string, unknown> | undefined): string | undefined {
	const command = sanitizeMessage(args?.command);
	if (!command) return undefined;
	const token = command.split(/\s+/)[0] ?? command;
	const shown = token.includes("/") || token.includes("\\") ? lastSegment(token) : token;
	return shown.length > PEEK_MAX ? shown.slice(0, PEEK_MAX) : shown;
}

function genericPeek(args: Record<string, unknown> | undefined): string | undefined {
	if (!args) return undefined;
	for (const key of GENERIC_KEYS) {
		if (args[key] === undefined) continue;
		const peek =
			key === "path" || key === "file_path"
				? pathPeek(args)
				: key === "command"
					? bashPeek(args)
					: capPeek(args[key]);
		if (peek) return peek;
	}
	return undefined;
}

export function formatActivityMessage(
	toolName: unknown,
	args: Record<string, unknown> | undefined,
): string | undefined {
	const name = sanitizeMessage(toolName);
	if (!name) return undefined;

	let peek: string | undefined;
	let verb: string | undefined;
	switch (name) {
		case "read":
			verb = "Reading";
			peek = pathPeek(args);
			break;
		case "write":
			verb = "Writing";
			peek = pathPeek(args);
			break;
		case "edit":
			verb = "Editing";
			peek = pathPeek(args);
			break;
		case "grep":
		case "find":
			verb = "Searching";
			peek = searchPeek(args);
			break;
		case "ls":
			verb = "Listing";
			peek = pathPeek(args);
			break;
		case "bash":
			verb = "Running";
			peek = bashPeek(args);
			break;
		default:
			peek = genericPeek(args);
			return peek ? `Calling ${name} ${peek}` : `Calling ${name}`;
	}

	return peek ? `${verb} ${peek}` : verb;
}
