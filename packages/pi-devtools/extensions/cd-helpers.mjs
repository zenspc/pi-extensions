/**
 * Pure helpers for /cd path and flag parsing.
 * Kept as ESM so monorepo node:test can import without a TS build step.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve, normalize } from "node:path";

/**
 * @typedef {"continue" | "new" | "fork"} CdMode
 */

/**
 * @typedef {{ mode: CdMode, pathArg: string | null, errors: string[] }} ParsedCdArgs
 */

/**
 * Parse `/cd` arguments.
 * Flags: --new, --fork (mutually exclusive; last wins if both present with error).
 * Remaining tokens join as the path (supports spaces when quoted by the shell before pi).
 *
 * @param {string} args
 * @returns {ParsedCdArgs}
 */
export function parseCdArgs(args) {
	const errors = [];
	/** @type {CdMode} */
	let mode = "continue";
	const pathParts = [];
	const tokens = tokenizeArgs(args ?? "");

	for (const token of tokens) {
		if (token === "--new") {
			if (mode === "fork") {
				errors.push("Cannot combine --new and --fork");
			}
			mode = "new";
			continue;
		}
		if (token === "--fork") {
			if (mode === "new") {
				errors.push("Cannot combine --new and --fork");
			}
			mode = "fork";
			continue;
		}
		if (token.startsWith("--")) {
			errors.push(`Unknown flag: ${token}`);
			continue;
		}
		pathParts.push(token);
	}

	const pathArg = pathParts.length > 0 ? pathParts.join(" ") : null;
	return { mode, pathArg, errors };
}

/**
 * Shell-ish tokenization: whitespace split, keep "double" or 'single' quoted spans.
 * @param {string} input
 * @returns {string[]}
 */
export function tokenizeArgs(input) {
	const out = [];
	let cur = "";
	let quote = null;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				cur += ch;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (cur.length > 0) {
				out.push(cur);
				cur = "";
			}
			continue;
		}
		cur += ch;
	}
	if (cur.length > 0) out.push(cur);
	return out;
}

/**
 * Expand ~ and resolve relative to baseCwd. Does not touch the filesystem.
 * @param {string} pathArg
 * @param {string} baseCwd
 * @param {string} [home]
 * @returns {string}
 */
export function resolveTargetPath(pathArg, baseCwd, home = homedir()) {
	const trimmed = pathArg.trim();
	if (!trimmed) {
		throw new Error("Path is empty");
	}
	let expanded = trimmed;
	if (expanded === "~") {
		expanded = home;
	} else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
		expanded = home + expanded.slice(1);
	}
	const absolute = isAbsolute(expanded) ? expanded : resolve(baseCwd, expanded);
	return normalize(absolute);
}

/**
 * Compare two paths for same directory identity (normalized string compare).
 * Callers should realpath before this when both sides exist.
 * @param {string} a
 * @param {string} b
 */
export function pathsEqual(a, b) {
	return normalize(a) === normalize(b);
}

export const CD_USAGE =
	"Usage: /cd [path] [--new|--fork]\n" +
	"  (default) resume most recent session in path, or create one\n" +
	"  --new     always start a fresh session in path\n" +
	"  --fork    copy current session history into path\n" +
	"  /pwd      print current working directory";
