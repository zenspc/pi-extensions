/**
 * Pure helpers for /preview path resolution and file reading.
 * Kept as ESM so monorepo node:test can import without a TS build step.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const MAX_PREVIEW_BYTES = 512 * 1024;

/**
 * @typedef {{ ok: true, absolutePath: string, displayPath: string }}
 *   | { ok: false, error: string } ResolveResult
 */

/**
 * Format a resolved path for display: relative to cwd when inside cwd, else absolute.
 *
 * @param {string} p
 * @param {string} cwd
 * @returns {string}
 */
function displayPathFor(p, cwd) {
	const rel = relative(cwd, p);
	if (rel.length > 0 && rel !== "." && !rel.startsWith("..") && !isAbsolute(rel)) {
		return rel;
	}
	return p;
}

/**
 * Resolve `/preview` arguments to an existing file on disk.
 * Expands a leading ~, resolves against cwd, and retries once with ".md"
 * appended when the final segment has no extension.
 *
 * @param {string} args
 * @param {string} cwd
 * @param {string} [home]
 * @returns {ResolveResult}
 */
export function resolvePreviewTarget(args, cwd, home = homedir()) {
	const trimmed = (args ?? "").trim();
	if (!trimmed) {
		return { ok: false, error: "usage: /preview <file.md>" };
	}

	let expanded = trimmed;
	if (expanded === "~") {
		expanded = home;
	} else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
		expanded = home + expanded.slice(1);
	}

	const base = resolve(cwd, expanded);
	const candidates = [];
	if (existsSync(base) && statSync(base).isFile()) {
		candidates.push(base);
	}
	const finalSegment = basename(base);
	if (!finalSegment.includes(".")) {
		const withMd = join(dirname(base), finalSegment + ".md");
		if (existsSync(withMd) && statSync(withMd).isFile()) {
			candidates.push(withMd);
		}
	}

	if (candidates.length === 0) {
		if (existsSync(base) && statSync(base).isDirectory()) {
			return { ok: false, error: `${displayPathFor(base, cwd)}: not a file` };
		}
		return { ok: false, error: `${displayPathFor(base, cwd)}: no such file` };
	}

	const p = candidates[0];
	return { ok: true, absolutePath: p, displayPath: displayPathFor(p, cwd) };
}

/**
 * Read a preview file synchronously with a size cap.
 *
 * @param {string} absolutePath
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
export function readPreviewFile(absolutePath) {
	const name = basename(absolutePath);
	try {
		const stats = statSync(absolutePath);
		if (stats.size > MAX_PREVIEW_BYTES) {
			return { ok: false, error: `${name}: file exceeds 512 KiB preview limit` };
		}
		return { ok: true, content: readFileSync(absolutePath, "utf8") };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `${name}: ${message}` };
	}
}
