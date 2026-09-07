/**
 * Built-in animation presets for the spinner.
 *
 * Each preset declares raw frames + a frame interval. The active theme is
 * applied to the frames when the indicator is set, so theme changes (light /
 * dark) flow through naturally.
 */

import type { Theme, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { findCustom, type SpinnerConfig } from "./config.ts";
import { DEFAULT_MESSAGES, PRESET_NAMES, type BuiltinPresetName } from "./constants.ts";

export { DEFAULT_MESSAGES, PRESET_NAMES };
export type { BuiltinPresetName };

export interface PresetDefinition {
	readonly name: BuiltinPresetName;
	readonly label: string;
	readonly description: string;
	readonly rawFrames: string[];
	readonly intervalMs: number;
	/**
	 * Either a single theme color key, or a list of keys to rotate through
	 * frame-by-frame (used by the rainbow preset).
	 */
	readonly colorKeys: readonly string[];
}

export const PRESETS: readonly PresetDefinition[] = [
	{
		name: "braille",
		label: "Braille spinner",
		description: "Pi's default 10-frame braille animation in the accent color.",
		rawFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		intervalMs: 80,
		colorKeys: ["accent"],
	},
	{
		name: "dots",
		label: "Dots pulse",
		description: "Subtle dim-to-accent pulse: · • ● •",
		rawFrames: ["·", "•", "●", "•"],
		intervalMs: 140,
		colorKeys: ["dim", "muted", "accent", "muted"],
	},
	{
		name: "arrows",
		label: "Rotating arrows",
		description: "Eight arrows spinning around the compass.",
		rawFrames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
		intervalMs: 110,
		colorKeys: ["accent"],
	},
	{
		name: "bars",
		label: "Audio bars",
		description: "12 bars growing and shrinking like a VU meter.",
		rawFrames: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
		intervalMs: 100,
		colorKeys: ["accent"],
	},
	{
		name: "progress",
		label: "Progress fill",
		description: "Five-frame progress bar that resets and fills again.",
		rawFrames: ["▱▱▱▱▱", "▰▱▱▱▱", "▰▰▱▱▱", "▰▰▰▱▱", "▰▰▰▰▱", "▰▰▰▰▰"],
		intervalMs: 250,
		colorKeys: ["accent"],
	},
	{
		name: "rainbow",
		label: "Rainbow dots",
		description: "Dots cycling through the full theme color palette.",
		rawFrames: ["●", "●", "●", "●", "●", "●"],
		intervalMs: 130,
		colorKeys: ["error", "warning", "success", "accent", "muted", "dim"],
	},
	{
		name: "line",
		label: "Line spinner",
		description: "Classic ASCII | / - \\ spinner. Works in every terminal.",
		rawFrames: ["-", "\\", "|", "/"],
		intervalMs: 130,
		colorKeys: ["accent"],
	},
	{
		name: "arc",
		label: "Arc spinner",
		description: "Six-frame circular arc.",
		rawFrames: ["◜", "◠", "◝", "◞", "◡", "◟"],
		intervalMs: 100,
		colorKeys: ["accent"],
	},
	{
		name: "star",
		label: "Star pulse",
		description: "Sparkle that grows and shrinks.",
		rawFrames: ["✶", "✸", "✹", "✺", "✹", "✷"],
		intervalMs: 70,
		colorKeys: ["accent"],
	},
	{
		name: "box",
		label: "Box bounce",
		description: "Four quadrants bouncing around a cell.",
		rawFrames: ["▖", "▘", "▝", "▗"],
		intervalMs: 80,
		colorKeys: ["accent"],
	},
	{
		name: "hamburger",
		label: "Hamburger",
		description: "Three-frame trigram morph.",
		rawFrames: ["☱", "☲", "☴"],
		intervalMs: 100,
		colorKeys: ["accent"],
	},
	{
		name: "point",
		label: "Point chase",
		description: "A dot running through an ellipsis.",
		rawFrames: ["∙∙∙", "●∙∙", "∙●∙", "∙∙●", "∙∙∙"],
		intervalMs: 125,
		colorKeys: ["accent"],
	},
	{
		name: "minimal",
		label: "Minimal ellipsis",
		description: "Static muted ellipsis, no animation. Calmest option.",
		rawFrames: ["…"],
		intervalMs: 1000,
		colorKeys: ["muted"],
	},
	{
		name: "dot",
		label: "Static dot",
		description: "Single accent dot. No animation.",
		rawFrames: ["●"],
		intervalMs: 1000,
		colorKeys: ["accent"],
	},
	{
		name: "hidden",
		label: "Hidden",
		description: "No glyph. Message text still rotates.",
		rawFrames: [],
		intervalMs: 1000,
		colorKeys: ["accent"],
	},
];

/** Find a preset by name. Returns undefined if not found. */
export function findPreset(name: string | undefined): PresetDefinition | undefined {
	if (!name) return undefined;
	return PRESETS.find((p) => p.name === name);
}

export type ResolvedAnimation = {
	name: string;
	label: string;
	frames: readonly string[];
	intervalMs: number;
	colorKeys: readonly string[];
	kind: "builtin" | "custom";
};

export function resolveAnimation(cfg: Pick<SpinnerConfig, "preset" | "customs">): ResolvedAnimation {
	const builtin = findPreset(cfg.preset);
	if (builtin) {
		return {
			name: builtin.name,
			label: builtin.label,
			frames: builtin.rawFrames,
			intervalMs: builtin.intervalMs,
			colorKeys: builtin.colorKeys,
			kind: "builtin",
		};
	}

	const custom = findCustom(cfg.customs, cfg.preset);
	if (custom) {
		return {
			name: custom.name,
			label: custom.name,
			frames: custom.frames,
			intervalMs: custom.intervalMs,
			colorKeys: ["accent"],
			kind: "custom",
		};
	}

	const fallback = PRESETS[0];
	return {
		name: fallback?.name ?? "braille",
		label: fallback?.label ?? "Braille spinner",
		frames: fallback?.rawFrames ?? [],
		intervalMs: fallback?.intervalMs ?? 80,
		colorKeys: fallback?.colorKeys ?? ["accent"],
		kind: "builtin",
	};
}

/**
 * The theme is required so that frames can be wrapped in `theme.fg(...)`. Frames
 * are rendered verbatim by pi, so the extension owns coloring.
 */
export function buildIndicator(
	cfg: Pick<SpinnerConfig, "preset" | "customs">,
	theme: Theme,
): WorkingIndicatorOptions | undefined {
	const anim = resolveAnimation(cfg);
	if (anim.frames.length === 0) return { frames: [] };

	const frames = anim.frames.map((frame, i) => {
		const key = anim.colorKeys[i % anim.colorKeys.length] ?? "accent";
		return theme.fg(key as Parameters<Theme["fg"]>[0], frame);
	});
	return { frames, intervalMs: anim.intervalMs };
}

/**
 * Apply theme color to a message. Uses `muted` so messages read as
 * informational rather than alarming, but still visible.
 */
export function themeMessage(message: string, theme: Theme): string {
	return theme.fg("muted", message);
}
