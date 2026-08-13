/**
 * /spinner slash-arg parsing, help/status text, and completions.
 * Persistence stays in the extension.
 */

import { CYCLE_MODES, MESSAGE_PACK_NAMES, PRESET_NAMES } from "./constants.ts";
import { isKnownCycleMode, isKnownMessagePack, isKnownPreset, type SpinnerConfig } from "./config.ts";

export type SpinnerCommand =
	| { action: "menu" }
	| { action: "help" }
	| { action: "status" }
	| { action: "preset"; name: string }
	| { action: "pack"; name: string }
	| { action: "cycleMode"; mode: "random" | "sequential" }
	| { action: "rotate" }
	| { action: "reset"; target: "all" | "global" | "project" }
	| { action: "unknown"; token: string };

export type AutocompleteItem = {
	value: string;
	label: string;
};

export type SpinnerPaths = {
	global: string;
	project: string;
};

const FIRST_TOKENS = [
	"help",
	"status",
	"rotate",
	"reset",
	"pack",
	...CYCLE_MODES,
	...PRESET_NAMES,
] as const;

export function parseSpinnerCommand(args: string): SpinnerCommand {
	const trimmed = (args ?? "").trim();
	if (!trimmed) return { action: "menu" };

	const lower = trimmed.toLowerCase();
	const parts = lower.split(/\s+/).filter(Boolean);
	const first = parts[0] ?? "";

	if (parts.length === 1) {
		if (first === "help") return { action: "help" };
		if (first === "status") return { action: "status" };
		if (first === "rotate") return { action: "rotate" };
		if (first === "reset") return { action: "reset", target: "all" };
		if (isKnownCycleMode(first)) return { action: "cycleMode", mode: first };
		if (isKnownPreset(first)) return { action: "preset", name: first };
		return { action: "unknown", token: trimmed };
	}

	if (first === "reset" && parts.length === 2) {
		const target = parts[1];
		if (target === "global" || target === "project") {
			return { action: "reset", target };
		}
	}

	if (first === "pack" && parts.length === 2) {
		const name = parts[1];
		if (isKnownMessagePack(name)) return { action: "pack", name };
	}

	return { action: "unknown", token: trimmed };
}

export function formatSpinnerHelp(paths: SpinnerPaths): string {
	return [
		"Usage: /spinner [status|help|rotate|reset|pack <name>|<preset>|random|sequential]",
		"",
		"  (no args)           Open the customization TUI",
		"  status              Show merged config and paths",
		"  help                Show this help",
		"  <preset>            Set animation preset (dots, hidden, ...)",
		"  pack <name>         Replace messages with a built-in pack (default, calm, dry)",
		"  random              Set cycle order to random",
		"  sequential          Set cycle order to sequential",
		"  rotate              Advance to the next message",
		"  reset               Delete global and project config",
		"  reset global        Delete only the global config",
		"  reset project       Delete only the project config",
		"",
		`Global: ${paths.global}`,
		`Project: ${paths.project}`,
	].join("\n");
}

export function formatSpinnerStatus(cfg: SpinnerConfig, paths: SpinnerPaths): string {
	return [
		`Preset: ${cfg.preset}`,
		`Custom frames: ${cfg.customFrames.length}`,
		`Messages: ${cfg.messages.length}`,
		`Pack: ${cfg.messagePack}`,
		`Cycle mode: ${cfg.cycleMode}`,
		`Interval: ${cfg.cycleIntervalMs}ms`,
		`Customized: ${cfg.customized ? "yes" : "no"}`,
		`Global: ${paths.global}`,
		`Project: ${paths.project}`,
	].join("\n");
}

export function getSpinnerArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const raw = typeof prefix === "string" ? prefix : "";
	const hasTrailingSpace = /\s$/.test(raw);
	const parts = raw.trim().split(/\s+/).filter(Boolean);

	if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
		const start = (parts[0] ?? "").toLowerCase();
		const items = FIRST_TOKENS.filter((token) => token.startsWith(start)).map((token) => ({
			value: token,
			label: token,
		}));
		return items.length > 0 ? items : null;
	}

	const first = parts[0]?.toLowerCase();
	if (first === "pack" && (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace))) {
		const start = (parts[1] ?? "").toLowerCase();
		const items = MESSAGE_PACK_NAMES.filter((name) => name.startsWith(start)).map((name) => ({
			value: `pack ${name}`,
			label: name,
		}));
		return items.length > 0 ? items : null;
	}

	if (first === "reset" && (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace))) {
		const start = (parts[1] ?? "").toLowerCase();
		const items = (["global", "project"] as const)
			.filter((name) => name.startsWith(start))
			.map((name) => ({ value: `reset ${name}`, label: name }));
		return items.length > 0 ? items : null;
	}

	return null;
}
