/**
 * Config IO for the pi-spinner extension.
 *
 * Two layers, merged in order (later wins):
 *   1. Built-in defaults
 *   2. Global:    ~/.pi/agent/extensions/spinner.json
 *   3. Project:   <cwd>/.pi/spinner.json
 *
 * Bad JSON in any user file is logged once and ignored so the extension
 * never wedges startup.
 *
 * The returned config carries a `customized` flag: true if either user file
 * existed on disk, false if both were absent. The extension uses this to
 * honour the README's "no rotation by default" promise - we only start the
 * message cycler when the user has actually configured something.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MESSAGES } from "./presets.js";

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

const MIN_INTERVAL_MS = 1500;
const MAX_INTERVAL_MS = 15000;
const MIN_FRAME_INTERVAL_MS = 50;
const MAX_FRAME_INTERVAL_MS = 2000;
const MAX_FRAME_LENGTH = 4;
const MAX_CUSTOM_FRAMES = 32;

function defaults(): SpinnerConfig {
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

function readJsonSafe(path: string): UserSpinnerConfig | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			console.warn(`[pi-spinner] ${path} is not a JSON object; ignoring.`);
			return undefined;
		}
		return parsed as UserSpinnerConfig;
	} catch (err) {
		console.warn(`[pi-spinner] Could not parse ${path}: ${err instanceof Error ? err.message : err}`);
		return undefined;
	}
}

function merge(base: SpinnerConfig, override: UserSpinnerConfig | undefined): SpinnerConfig {
	if (!override) return base;
	const next: SpinnerConfig = { ...base };

	if (typeof override.preset === "string" && override.preset.length > 0) {
		next.preset = override.preset;
	}
	if (Array.isArray(override.messages)) {
		const cleaned = override.messages
			.filter((m): m is string => typeof m === "string")
			.map((m) => m.trim())
			.filter((m) => m.length > 0);
		if (cleaned.length > 0) next.messages = cleaned;
	}
	if (typeof override.cycleIntervalMs === "number") {
		next.cycleIntervalMs = clamp(override.cycleIntervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
	}
	if (Array.isArray(override.customFrames)) {
		const frames = override.customFrames
			.filter((f): f is string => typeof f === "string" && f.length > 0 && f.length <= MAX_FRAME_LENGTH)
			.slice(0, MAX_CUSTOM_FRAMES);
		next.customFrames = frames;
	}
	if (typeof override.customIntervalMs === "number") {
		next.customIntervalMs = clamp(override.customIntervalMs, MIN_FRAME_INTERVAL_MS, MAX_FRAME_INTERVAL_MS);
	}
	return next;
}

/** Path to the global config file. */
export function globalConfigPath(): string {
	return join(getAgentDir(), "extensions", "spinner.json");
}

/** Path to the project-local config file. */
export function projectConfigPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "spinner.json");
}

/** Load the merged config (defaults < global < project). */
export function loadConfig(cwd: string): SpinnerConfig {
	const globalRaw = readJsonSafe(globalConfigPath());
	const projectRaw = readJsonSafe(projectConfigPath(cwd));
	const merged = merge(merge(defaults(), globalRaw), projectRaw);
	return { ...merged, customized: globalRaw !== undefined || projectRaw !== undefined };
}

/** Where a "save to global" / "save to project" action should write. */
export type SaveTarget = "global" | "project";

/**
 * Persist a partial config to either the global or project path. Other keys
 * in the existing file are preserved (merged before write).
 */
export function saveConfig(target: SaveTarget, partial: UserSpinnerConfig, cwd: string): { path: string } {
	const path = target === "global" ? globalConfigPath() : projectConfigPath(cwd);

	const existing = readJsonSafe(path) ?? {};
	const next: UserSpinnerConfig = { ...existing, ...partial };

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, "\t")}\n`, "utf-8");
	return { path };
}

/**
 * Delete the config file at the given target. Returns whether a file was
 * actually removed; never throws on a missing file.
 */
export function deleteConfig(target: SaveTarget, cwd: string): { path: string; deleted: boolean } {
	const path = target === "global" ? globalConfigPath() : projectConfigPath(cwd);
	if (!existsSync(path)) return { path, deleted: false };
	try {
		unlinkSync(path);
		return { path, deleted: true };
	} catch (err) {
		console.warn(`[pi-spinner] Could not delete ${path}: ${err instanceof Error ? err.message : err}`);
		return { path, deleted: false };
	}
}

/** Re-export the limits so the UI can clamp input. */
export const LIMITS = {
	MIN_INTERVAL_MS,
	MAX_INTERVAL_MS,
	MIN_FRAME_INTERVAL_MS,
	MAX_FRAME_INTERVAL_MS,
	MAX_FRAME_LENGTH,
	MAX_CUSTOM_FRAMES,
} as const;
