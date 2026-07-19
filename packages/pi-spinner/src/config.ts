/**
 * Config IO for the pi-spinner extension.
 *
 * Two layers, merged in order (later wins):
 *   1. Built-in defaults
 *   2. Global:    ~/.pi/agent/extensions/spinner.json
 *   3. Project:   <cwd>/.pi/spinner.json
 *
 * Trust boundary: both config files are untrusted input (especially the
 * project-local file, which travels with a cloned repo). Everything is
 * size-capped, type-checked, allowlisted, and stripped of control / ANSI
 * sequences before it reaches the TUI.
 *
 * Bad JSON, oversized files, symlinks, and non-regular paths are logged once
 * and ignored so the extension never wedges startup.
 *
 * The returned config carries a `customized` flag: true if either user file
 * existed on disk as a readable regular file, false if both were absent or
 * rejected. The extension uses this to honour the README's "no rotation by
 * default" promise - we only start the message cycler when the user has
 * actually configured something.
 */

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DEFAULT_MESSAGES, PRESET_NAMES } from "./constants.ts";

/** Same project config dir name pi uses (see pi's CONFIG_DIR_NAME). */
const PROJECT_CONFIG_DIR = ".pi";

/**
 * Same base dir as pi's agent config (including PI_CODING_AGENT_DIR).
 * Kept local so config IO stays testable without the peer package installed.
 */
export function getSpinnerAgentDir(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${home()}$1`)
		: join(home(), ".pi", "agent");
}

/** Subset of the SpinnerConfig that the user can override. */
export interface UserSpinnerConfig {
	preset?: string;
	messages?: string[];
	cycleIntervalMs?: number;
	customFrames?: string[];
	customIntervalMs?: number;
}

export interface SpinnerConfig {
	preset: string;
	messages: string[];
	cycleIntervalMs: number;
	customFrames: string[];
	customIntervalMs: number;
	/** True when at least one user config file was found on disk. */
	customized: boolean;
}

/** Cap untrusted config file size (DoS / parse cost). */
export const MAX_CONFIG_BYTES = 100_000;

const MIN_INTERVAL_MS = 1500;
const MAX_INTERVAL_MS = 15000;
const MIN_FRAME_INTERVAL_MS = 50;
const MAX_FRAME_INTERVAL_MS = 2000;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 120;
const MAX_FRAME_LENGTH = 4;
const MAX_CUSTOM_FRAMES = 32;
const MAX_PRESET_LENGTH = 32;

const PRESET_NAME_SET: ReadonlySet<string> = new Set(PRESET_NAMES);

/** CSI / OSC ANSI sequences that must never reach the TUI. */
const ANSI_RE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char scrubber
	/\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char scrubber
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Built-in defaults. Exported so the TUI reset path shares a single source of truth
 * with loadConfig().
 */
export function defaults(): SpinnerConfig {
	return {
		preset: "braille",
		messages: [...DEFAULT_MESSAGES],
		cycleIntervalMs: 5000,
		customFrames: [],
		customIntervalMs: 100,
		customized: false,
	};
}

function clamp(n: number, lo: number, hi: number): number {
	if (!Number.isFinite(n)) return lo;
	return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Strip ANSI escape sequences and C0/C1 control characters, then trim and
 * hard-cap length. Empty results are rejected by callers.
 */
export function sanitizeDisplayText(raw: unknown, maxLen: number): string | undefined {
	if (typeof raw !== "string") return undefined;
	const cleaned = raw.replace(ANSI_RE, "").replace(CONTROL_RE, "").trim();
	if (cleaned.length === 0) return undefined;
	return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/** Sanitize one loader message (overlong text is truncated). */
export function sanitizeMessage(raw: unknown): string | undefined {
	return sanitizeDisplayText(raw, MAX_MESSAGE_LENGTH);
}

/**
 * Sanitize one custom animation frame (short glyph sequence).
 * Overlong frames are dropped rather than truncated so multi-codepoint
 * glyphs are not silently sliced mid-sequence.
 */
export function sanitizeFrame(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const cleaned = raw.replace(ANSI_RE, "").replace(CONTROL_RE, "").trim();
	if (cleaned.length === 0 || cleaned.length > MAX_FRAME_LENGTH) return undefined;
	return cleaned;
}

/** True when the name is a known built-in preset. */
export function isKnownPreset(name: unknown): name is string {
	return typeof name === "string" && PRESET_NAME_SET.has(name);
}

/**
 * Coerce unknown JSON into a partial user config. Only allowlisted keys and
 * sanitized values survive. Never throws.
 */
export function parseUserSpinnerConfig(raw: unknown): UserSpinnerConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

	const src = raw as Record<string, unknown>;
	const out: UserSpinnerConfig = {};

	if (typeof src.preset === "string") {
		const preset = src.preset.trim().slice(0, MAX_PRESET_LENGTH);
		// Unknown presets are dropped (merge keeps the previous / default).
		// Known names only - no free-form strings into the indicator path.
		if (isKnownPreset(preset)) out.preset = preset;
	}

	if (Array.isArray(src.messages)) {
		const messages: string[] = [];
		for (const entry of src.messages) {
			if (messages.length >= MAX_MESSAGES) break;
			const msg = sanitizeMessage(entry);
			if (msg) messages.push(msg);
		}
		if (messages.length > 0) out.messages = messages;
	}

	if (typeof src.cycleIntervalMs === "number") {
		out.cycleIntervalMs = clamp(src.cycleIntervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
	}

	if (Array.isArray(src.customFrames)) {
		const frames: string[] = [];
		for (const entry of src.customFrames) {
			if (frames.length >= MAX_CUSTOM_FRAMES) break;
			const frame = sanitizeFrame(entry);
			if (frame) frames.push(frame);
		}
		// Empty after sanitization means "clear custom frames" only when the
		// key was explicitly present as an array - callers merge accordingly.
		out.customFrames = frames;
	}

	if (typeof src.customIntervalMs === "number") {
		out.customIntervalMs = clamp(src.customIntervalMs, MIN_FRAME_INTERVAL_MS, MAX_FRAME_INTERVAL_MS);
	}

	return out;
}

/**
 * Apply a sanitized user override onto a base config. Does not touch
 * `customized` - the loader sets that based on whether files existed.
 */
export function mergeSpinnerConfig(base: SpinnerConfig, override: UserSpinnerConfig | undefined): SpinnerConfig {
	if (!override) return base;
	const next: SpinnerConfig = {
		...base,
		messages: [...base.messages],
		customFrames: [...base.customFrames],
	};

	if (override.preset !== undefined) next.preset = override.preset;
	if (override.messages !== undefined && override.messages.length > 0) {
		next.messages = [...override.messages];
	}
	if (override.cycleIntervalMs !== undefined) next.cycleIntervalMs = override.cycleIntervalMs;
	if (override.customFrames !== undefined) next.customFrames = [...override.customFrames];
	if (override.customIntervalMs !== undefined) next.customIntervalMs = override.customIntervalMs;
	return next;
}

/**
 * Read and parse one config file. Returns undefined when the path is missing,
 * not a regular file, oversized, unreadable, or not a JSON object.
 */
export function readConfigFile(path: string): UserSpinnerConfig | undefined {
	try {
		if (!existsSync(path)) return undefined;
		// lstat: refuse symlinks, dirs, devices - only a regular file is trusted.
		const st = lstatSync(path);
		if (!st.isFile()) {
			console.warn(`[pi-spinner] ${path} is not a regular file; ignoring.`);
			return undefined;
		}
		if (st.size > MAX_CONFIG_BYTES) {
			console.warn(`[pi-spinner] ${path} is unexpectedly large (${st.size} bytes); ignoring.`);
			return undefined;
		}
		const raw = readFileSync(path, "utf-8");
		if (raw.length > MAX_CONFIG_BYTES) {
			console.warn(`[pi-spinner] ${path} exceeds size cap; ignoring.`);
			return undefined;
		}
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			console.warn(`[pi-spinner] ${path} is not a JSON object; ignoring.`);
			return undefined;
		}
		return parseUserSpinnerConfig(parsed);
	} catch (err) {
		console.warn(`[pi-spinner] Could not read ${path}: ${err instanceof Error ? err.message : err}`);
		return undefined;
	}
}

/**
 * Persist a partial config to `path`. Other allowlisted keys already on disk
 * are preserved. Writes atomically via temp + rename, mode 0o600.
 * Returns false on failure (never throws to callers that prefer a bool).
 */
export function writeConfigFile(path: string, partial: UserSpinnerConfig): { ok: true } | { ok: false; error: string } {
	const existing = readConfigFile(path) ?? {};
	const cleanedPartial = parseUserSpinnerConfig(partial);
	const next = parseUserSpinnerConfig({ ...existing, ...cleanedPartial });

	// Stable key order for readable diffs.
	const ordered: Record<string, unknown> = {};
	if (next.preset !== undefined) ordered.preset = next.preset;
	if (next.messages !== undefined) ordered.messages = next.messages;
	if (next.cycleIntervalMs !== undefined) ordered.cycleIntervalMs = next.cycleIntervalMs;
	if (next.customFrames !== undefined && next.customFrames.length > 0) {
		ordered.customFrames = next.customFrames;
	}
	if (next.customIntervalMs !== undefined) ordered.customIntervalMs = next.customIntervalMs;

	const body = `${JSON.stringify(ordered, null, "\t")}\n`;
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);

	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (existsSync(path)) {
			const st = lstatSync(path);
			if (!st.isFile()) {
				return { ok: false, error: `refusing to overwrite non-regular path ${path}` };
			}
		}
		writeFileSync(tmp, body, { encoding: "utf-8", mode: 0o600 });
		renameSync(tmp, path);
		return { ok: true };
	} catch (err) {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			// best-effort temp cleanup
		}
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Delete a config file. Refuses non-regular paths. Missing file is success
 * with deleted=false.
 */
export function deleteConfigFile(path: string): { path: string; deleted: boolean } {
	try {
		if (!existsSync(path)) return { path, deleted: false };
		const st = lstatSync(path);
		if (!st.isFile()) {
			console.warn(`[pi-spinner] refusing to delete non-regular path ${path}`);
			return { path, deleted: false };
		}
		unlinkSync(path);
		return { path, deleted: true };
	} catch (err) {
		console.warn(`[pi-spinner] Could not delete ${path}: ${err instanceof Error ? err.message : err}`);
		return { path, deleted: false };
	}
}

/** Path to the global config file. */
export function globalConfigPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	return join(getSpinnerAgentDir(env, home), "extensions", "spinner.json");
}

/** Path to the project-local config file. */
export function projectConfigPath(cwd: string): string {
	return join(cwd, PROJECT_CONFIG_DIR, "spinner.json");
}

/**
 * Load the merged config from explicit paths (defaults < global < project).
 * Used by tests and by loadConfig().
 */
export function loadConfigFromPaths(globalPath: string, projectPath: string): SpinnerConfig {
	const globalRaw = readConfigFile(globalPath);
	const projectRaw = readConfigFile(projectPath);
	const merged = mergeSpinnerConfig(mergeSpinnerConfig(defaults(), globalRaw), projectRaw);
	return {
		...merged,
		customized: globalRaw !== undefined || projectRaw !== undefined,
	};
}

/** Load the merged config (defaults < global < project). */
export function loadConfig(cwd: string): SpinnerConfig {
	return loadConfigFromPaths(globalConfigPath(), projectConfigPath(cwd));
}

/** Where a "save to global" / "save to project" action should write. */
export type SaveTarget = "global" | "project";

/**
 * Persist a partial config to either the global or project path. Other keys
 * in the existing file are preserved (merged before write). Throws on failure
 * so the TUI can surface the error.
 */
export function saveConfig(target: SaveTarget, partial: UserSpinnerConfig, cwd: string): { path: string } {
	const path = target === "global" ? globalConfigPath() : projectConfigPath(cwd);
	const result = writeConfigFile(path, partial);
	if (!result.ok) throw new Error(result.error);
	return { path };
}

/**
 * Delete the config file at the given target. Returns whether a file was
 * actually removed; never throws on a missing file.
 */
export function deleteConfig(target: SaveTarget, cwd: string): { path: string; deleted: boolean } {
	const path = target === "global" ? globalConfigPath() : projectConfigPath(cwd);
	return deleteConfigFile(path);
}

/** Re-export the limits so the UI can clamp input. */
export const LIMITS = {
	MIN_INTERVAL_MS,
	MAX_INTERVAL_MS,
	MIN_FRAME_INTERVAL_MS,
	MAX_FRAME_INTERVAL_MS,
	MAX_MESSAGES,
	MAX_MESSAGE_LENGTH,
	MAX_FRAME_LENGTH,
	MAX_CUSTOM_FRAMES,
	MAX_CONFIG_BYTES,
	MAX_PRESET_LENGTH,
} as const;
