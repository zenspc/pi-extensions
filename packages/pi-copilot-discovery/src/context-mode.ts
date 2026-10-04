/**
 * Default vs long context preference for Copilot models with tiered pricing.
 *
 * "default" caps contextWindow at the short-tier ceiling (from pricing tiers)
 * so sessions stay in the cheaper rate band. "long" uses the full window
 * advertised by /models (typically ~1M).
 *
 * Preference is stored at ~/.pi/agent/copilot-context.json (or under
 * PI_CODING_AGENT_DIR). Missing/invalid files mean "default".
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type ContextMode, getAgentDir } from "./pricing.ts";

export type { ContextMode };

const CONTEXT_FILENAME = "copilot-context.json";

export function getContextModePath(): string {
	return join(getAgentDir(), CONTEXT_FILENAME);
}

export function isContextMode(value: unknown): value is ContextMode {
	return value === "default" || value === "long";
}

export function parseContextMode(value: unknown): ContextMode {
	if (isContextMode(value)) return value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const mode = (value as { mode?: unknown }).mode;
		if (isContextMode(mode)) return mode;
	}
	return "default";
}

/** Parse CLI/command args: "", "default", "long", "status", etc. */
export function parseContextModeArg(raw: unknown): ContextMode | "status" | "invalid" {
	const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (!text || text === "status" || text === "show") return "status";
	if (text === "default" || text === "short" || text === "cheap") return "default";
	if (text === "long" || text === "max" || text === "full") return "long";
	return "invalid";
}

export async function loadContextMode(): Promise<ContextMode> {
	try {
		const buf = await readFile(getContextModePath(), "utf8");
		if (buf.length > 100_000) {
			console.error("pi-copilot-discovery: copilot-context.json is unexpectedly large; ignoring");
			return "default";
		}
		return parseContextMode(JSON.parse(buf) as unknown);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			console.error(
				`pi-copilot-discovery: could not load context mode (${err instanceof Error ? err.message : String(err)})`,
			);
		}
		return "default";
	}
}

export async function saveContextMode(mode: ContextMode): Promise<void> {
	const path = getContextModePath();
	const body = `${JSON.stringify({ mode }, null, 2)}\n`;
	await writeFile(path, body, "utf8");
}
