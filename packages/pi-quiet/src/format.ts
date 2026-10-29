import { stripVTControlCharacters } from "node:util";
import { basename } from "node:path";
import type { QuietOutcome } from "./classify.ts";

export type GroupKind = "file" | "search" | "dir";
export type Summary = { verb: string; target: string; detail?: string };

export function plain(text: string): string {
	return stripVTControlCharacters(text).replace(
		/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
		""
	);
}

export function label(value: unknown, limit = 120): string {
	const text = plain(typeof value === "string" ? value : "")
		.replace(/\s+/gu, " ")
		.trim();
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function groupKind(tool: string): GroupKind | undefined {
	if (tool === "read") return "file";
	if (tool === "grep" || tool === "find") return "search";
	if (tool === "ls") return "dir";
	return undefined;
}

export function groupSummary(kind: GroupKind, count: number): Summary {
	const [verb, noun] =
		kind === "file"
			? ["Read", "file"]
			: kind === "search"
			? ["Searched", "pattern"]
			: ["Listed", "dir"];
	return { verb, target: `${count} ${noun}${count === 1 ? "" : "s"}` };
}

export function displayPath(value: unknown, cwd: string): string {
	let path = label(value, 240);
	if (path.startsWith(`${cwd}/`)) path = path.slice(cwd.length + 1);
	return path || "…";
}

function argPeek(args: Record<string, unknown>): string {
	// Only known descriptive fields are shown; never arbitrary secret-bearing arguments.
	for (const key of ["path", "pattern", "query", "name", "tool"] as const) {
		if (typeof args[key] === "string" && args[key])
			return label(args[key], 80);
	}
	return "";
}

export function summarize(
	tool: string,
	args: Record<string, unknown>,
	cwd: string,
	outcome?: QuietOutcome
): Summary {
	const running = !outcome || outcome.kind === "pending";
	const detail = outcome?.chip;
	const target = displayPath(args.path, cwd);
	switch (tool) {
		case "read": {
			let range: string | undefined;
			const offset =
				typeof args.offset === "number" && args.offset > 0
					? args.offset
					: 1;
			if (typeof args.limit === "number" && args.limit > 0)
				range = `${offset}-${offset + args.limit - 1}`;
			else if (typeof args.offset === "number") range = `${offset}-`;
			return {
				verb: running ? "Reading" : "Read",
				target,
				detail: range && outcome?.kind !== "hard" ? range : detail,
			};
		}
		case "grep":
		case "find":
			return {
				verb: running ? "Searching" : "Searched",
				target: label(args.pattern) || "…",
				detail,
			};
		case "ls":
			return {
				verb: running ? "Listing" : "Listed",
				target: args.path ? target : ".",
				detail,
			};
		case "edit":
			return { verb: running ? "Editing" : "Edited", target, detail };
		case "write":
			return { verb: running ? "Writing" : "Wrote", target, detail };
		case "bash":
		case "powershell":
			return {
				verb: running ? "Running" : "Ran",
				target: label(args.command, 160) || "…",
				detail,
			};
		default: {
			const peek = argPeek(args);
			return {
				verb: running ? "Calling" : "Called",
				target: `${label(tool, 80)}${peek ? ` ${peek}` : ""}`,
				detail,
			};
		}
	}
}

export function failureTail(text: string): string {
	return plain(text).trimEnd().split("\n").slice(-12).join("\n").slice(-8000);
}

export function compactLocation(cwd: string, home: string): string {
	return label(
		home && (cwd === home || cwd.startsWith(`${home}/`))
			? `~${cwd.slice(home.length)}`
			: cwd,
		240
	);
}

export function workspaceName(cwd: string): string {
	return label(basename(cwd)) || cwd;
}
