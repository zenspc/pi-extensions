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
import {
	CYCLE_MODES,
	DEFAULT_MESSAGES,
	MESSAGE_PACK_NAMES,
	PRESET_NAMES,
	type CycleMode,
	type MessagePackName,
} from "./constants.ts";

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

export interface CustomSpinner {
	readonly name: string;
	readonly frames: readonly string[];
	readonly intervalMs: number;
}

/** Subset of the SpinnerConfig that the user can override. */
export interface UserSpinnerConfig {
	preset?: string;
	customs?: CustomSpinner[];
	messages?: string[];
	messagePack?: MessagePackName;
	cycleIntervalMs?: number;
	cycleMode?: CycleMode;
	activityMessages?: boolean;
	syncThinkingLabel?: boolean;
}

export interface SpinnerConfig {
	preset: string;
	customs: CustomSpinner[];
	messages: string[];
	messagePack: MessagePackName;
	cycleIntervalMs: number;
	cycleMode: CycleMode;
	activityMessages: boolean;
	syncThinkingLabel: boolean;
	/** True when at least one user config file was found on disk. */
	customized: boolean;
	/** True when a user file set something other than activityMessages or syncThinkingLabel. */
	hasRotationConfig: boolean;
}

/** Cap untrusted config file size (DoS / parse cost). */
export const MAX_CONFIG_BYTES = 100_000;

const MIN_INTERVAL_MS = 1500;
const MAX_INTERVAL_MS = 15000;
const MIN_FRAME_INTERVAL_MS = 50;
const MAX_FRAME_INTERVAL_MS = 2000;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 120;
const MAX_FRAME_LENGTH = 8;
const MAX_CUSTOM_FRAMES = 32;
const MAX_CUSTOM_SPINNERS = 20;
const MAX_PRESET_LENGTH = 32;
const DEFAULT_FRAME_INTERVAL_MS = 100;
const MIGRATED_CUSTOM_NAME = "custom";

const PRESET_NAME_SET: ReadonlySet<string> = new Set(PRESET_NAMES);
const CYCLE_MODE_SET: ReadonlySet<string> = new Set(CYCLE_MODES);
const MESSAGE_PACK_SET: ReadonlySet<string> = new Set(MESSAGE_PACK_NAMES);
const RESERVED_SLASH_VERBS: ReadonlySet<string> = new Set([
	"help",
	"status",
	"rotate",
	"reset",
	"pack",
	"random",
	"sequential",
]);
const CUSTOM_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

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
		customs: [],
		messages: [...DEFAULT_MESSAGES],
		messagePack: "default",
		cycleIntervalMs: 5000,
		cycleMode: "random",
		activityMessages: false,
		syncThinkingLabel: false,
		customized: false,
		hasRotationConfig: false,
	};
}

function clamp(n: number, lo: number, hi: number): number {
	if (!Number.isFinite(n)) return lo;
	return Math.max(lo, Math.min(hi, Math.round(n)));
}

function cloneCustom(entry: CustomSpinner): CustomSpinner {
	return { name: entry.name, frames: [...entry.frames], intervalMs: entry.intervalMs };
}

function cloneCustoms(customs: readonly CustomSpinner[]): CustomSpinner[] {
	return customs.map(cloneCustom);
}

function clampFrameInterval(n: number): number {
	return clamp(n, MIN_FRAME_INTERVAL_MS, MAX_FRAME_INTERVAL_MS);
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

function sanitizeIdentifier(raw: string): string {
	return raw.replace(ANSI_RE, "").replace(CONTROL_RE, "").trim().toLowerCase();
}

export function isReservedAnimationName(name: unknown): boolean {
	if (typeof name !== "string") return false;
	const ident = name.toLowerCase();
	return PRESET_NAME_SET.has(ident) || RESERVED_SLASH_VERBS.has(ident);
}

/** True when the name is a known built-in preset. */
export function isKnownPreset(name: unknown): name is string {
	return typeof name === "string" && PRESET_NAME_SET.has(name);
}

export function isValidCustomName(name: unknown): name is string {
	return typeof name === "string" && CUSTOM_NAME_RE.test(name) && !isReservedAnimationName(name);
}

/** True when the name is a known cycle mode. */
export function isKnownCycleMode(name: unknown): name is CycleMode {
	return typeof name === "string" && CYCLE_MODE_SET.has(name);
}

/** True when the name is a known message pack. */
export function isKnownMessagePack(name: unknown): name is MessagePackName {
	return typeof name === "string" && MESSAGE_PACK_SET.has(name);
}

function parseFrames(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const frames: string[] = [];
	for (const entry of raw) {
		if (frames.length >= MAX_CUSTOM_FRAMES) break;
		const frame = sanitizeFrame(entry);
		if (frame) frames.push(frame);
	}
	return frames;
}

function parseCustomSpinner(raw: unknown): CustomSpinner | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const src = raw as Record<string, unknown>;
	if (typeof src.name !== "string") return undefined;
	const name = sanitizeIdentifier(src.name);
	if (!isValidCustomName(name)) return undefined;
	const frames = parseFrames(src.frames);
	if (frames.length === 0) return undefined;
	const intervalMs =
		typeof src.intervalMs === "number" ? clampFrameInterval(src.intervalMs) : DEFAULT_FRAME_INTERVAL_MS;
	return { name, frames, intervalMs };
}

function parseCustoms(raw: unknown): CustomSpinner[] {
	if (!Array.isArray(raw)) return [];
	const byName = new Map<string, CustomSpinner>();
	const order: string[] = [];
	for (const entry of raw) {
		const custom = parseCustomSpinner(entry);
		if (!custom) continue;
		if (byName.has(custom.name)) {
			byName.set(custom.name, custom);
			continue;
		}
		if (byName.size >= MAX_CUSTOM_SPINNERS) continue;
		order.push(custom.name);
		byName.set(custom.name, custom);
	}
	const parsed: CustomSpinner[] = [];
	for (const name of order) {
		const entry = byName.get(name);
		if (entry) parsed.push(entry);
	}
	return parsed;
}

export function findCustom(
	customs: readonly CustomSpinner[],
	name: string,
): CustomSpinner | undefined {
	const needle = name.toLowerCase();
	return customs.find((entry) => entry.name === needle);
}

export function upsertCustom(
	customs: readonly CustomSpinner[],
	next: CustomSpinner,
): CustomSpinner[] {
	const name = next.name.toLowerCase();
	const entry = { name, frames: [...next.frames], intervalMs: next.intervalMs };
	const idx = customs.findIndex((item) => item.name === name);
	if (idx >= 0) {
		const copy = cloneCustoms(customs);
		copy[idx] = entry;
		return copy;
	}
	if (customs.length >= MAX_CUSTOM_SPINNERS) return cloneCustoms(customs);
	return [...cloneCustoms(customs), entry];
}

export function deleteCustom(cfg: SpinnerConfig, name: string): SpinnerConfig {
	const needle = name.toLowerCase();
	const customs = cfg.customs.filter((entry) => entry.name !== needle);
	const preset = cfg.preset.toLowerCase() === needle ? "braille" : cfg.preset;
	return normalizeAnimation({ ...cfg, customs, preset });
}

export function normalizeAnimation(cfg: SpinnerConfig): SpinnerConfig {
	if (isKnownPreset(cfg.preset)) return cfg;
	if (findCustom(cfg.customs, cfg.preset)) return cfg;
	return { ...cfg, preset: "braille" };
}

/**
 * Coerce unknown JSON into a partial user config. Only allowlisted keys and
 * sanitized values survive. Never throws.
 */
export function parseUserSpinnerConfig(raw: unknown): UserSpinnerConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

	const src = raw as Record<string, unknown>;
	const out: UserSpinnerConfig = {};

	if (Array.isArray(src.customs)) {
		out.customs = parseCustoms(src.customs);
	} else if (Array.isArray(src.customFrames)) {
		const frames = parseFrames(src.customFrames);
		if (frames.length > 0) {
			const intervalMs =
				typeof src.customIntervalMs === "number"
					? clampFrameInterval(src.customIntervalMs)
					: DEFAULT_FRAME_INTERVAL_MS;
			out.customs = [{ name: MIGRATED_CUSTOM_NAME, frames, intervalMs }];
		}
	}

	if (typeof src.preset === "string") {
		const preset = src.preset.trim().slice(0, MAX_PRESET_LENGTH);
		if (isKnownPreset(preset)) out.preset = preset;
		else {
			const ident = sanitizeIdentifier(preset);
			if (isValidCustomName(ident)) out.preset = ident;
		}
	}

	if (out.customs?.length === 1 && out.customs[0]?.name === MIGRATED_CUSTOM_NAME && !Array.isArray(src.customs)) {
		if (out.preset === undefined || isKnownPreset(out.preset)) {
			out.preset = MIGRATED_CUSTOM_NAME;
		}
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

	if (typeof src.messagePack === "string") {
		const pack = src.messagePack.trim().toLowerCase();
		if (isKnownMessagePack(pack)) out.messagePack = pack;
	}

	if (typeof src.cycleIntervalMs === "number") {
		out.cycleIntervalMs = clamp(src.cycleIntervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
	}

	if (typeof src.cycleMode === "string") {
		const mode = src.cycleMode.trim().toLowerCase();
		if (isKnownCycleMode(mode)) out.cycleMode = mode;
	}

	if (typeof src.activityMessages === "boolean") {
		out.activityMessages = src.activityMessages;
	}

	if (typeof src.syncThinkingLabel === "boolean") {
		out.syncThinkingLabel = src.syncThinkingLabel;
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
		customs: cloneCustoms(base.customs),
	};

	if (override.preset !== undefined) next.preset = override.preset;
	if (override.messages !== undefined && override.messages.length > 0) {
		next.messages = [...override.messages];
	}
	if (override.messagePack !== undefined) next.messagePack = override.messagePack;
	if (override.cycleIntervalMs !== undefined) next.cycleIntervalMs = override.cycleIntervalMs;
	if (override.cycleMode !== undefined) next.cycleMode = override.cycleMode;
	if (override.customs !== undefined) next.customs = cloneCustoms(override.customs);
	if (override.activityMessages !== undefined) next.activityMessages = override.activityMessages;
	if (override.syncThinkingLabel !== undefined) next.syncThinkingLabel = override.syncThinkingLabel;
	return normalizeAnimation(next);
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
	if (next.messagePack !== undefined) ordered.messagePack = next.messagePack;
	if (next.cycleIntervalMs !== undefined) ordered.cycleIntervalMs = next.cycleIntervalMs;
	if (next.cycleMode !== undefined) ordered.cycleMode = next.cycleMode;
	if (next.customs !== undefined) {
		ordered.customs = next.customs.map((entry) => ({
			name: entry.name,
			frames: [...entry.frames],
			intervalMs: entry.intervalMs,
		}));
	}
	if (next.activityMessages !== undefined) ordered.activityMessages = next.activityMessages;
	if (next.syncThinkingLabel !== undefined) ordered.syncThinkingLabel = next.syncThinkingLabel;

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
function hasRotationOverride(raw: UserSpinnerConfig | undefined): boolean {
	if (!raw) return false;
	return Object.keys(raw).some((key) => key !== "activityMessages" && key !== "syncThinkingLabel");
}

export function loadConfigFromPaths(globalPath: string, projectPath: string): SpinnerConfig {
	const globalRaw = readConfigFile(globalPath);
	const projectRaw = readConfigFile(projectPath);
	const merged = mergeSpinnerConfig(mergeSpinnerConfig(defaults(), globalRaw), projectRaw);
	return {
		...merged,
		customized: globalRaw !== undefined || projectRaw !== undefined,
		hasRotationConfig: hasRotationOverride(globalRaw) || hasRotationOverride(projectRaw),
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
	MAX_CUSTOM_SPINNERS,
	MAX_CONFIG_BYTES,
	MAX_PRESET_LENGTH,
} as const;
