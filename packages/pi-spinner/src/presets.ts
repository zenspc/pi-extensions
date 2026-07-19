/**
 * Built-in animation presets for the spinner.
 *
 * Each preset declares raw frames + a frame interval. The active theme is
 * applied to the frames when the indicator is set, so theme changes (light /
 * dark) flow through naturally.
 */

import type { Theme, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

/** Names of the shipped presets. "custom" means user-supplied raw frames. */
export type PresetName = "braille" | "dots" | "arrows" | "bars" | "progress" | "rainbow" | "minimal" | "custom";

export interface PresetDefinition {
	readonly name: PresetName;
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
		name: "minimal",
		label: "Minimal ellipsis",
		description: "Static muted ellipsis, no animation. Calmest option.",
		rawFrames: ["…"],
		intervalMs: 1000,
		colorKeys: ["muted"],
	},
];

/** Find a preset by name. Returns undefined if not found. */
export function findPreset(name: string | undefined): PresetDefinition | undefined {
	if (!name) return undefined;
	return PRESETS.find((p) => p.name === name);
}

/**
 * Build a WorkingIndicatorOptions value from a preset, a set of user-supplied
 * custom frames, or `undefined` (meaning: restore pi's default spinner).
 *
 * The theme is required so that frames can be wrapped in `theme.fg(...)`. Frames
 * are rendered verbatim by pi, so the extension owns coloring.
 */
export function buildIndicator(
	presetName: string | undefined,
	customFrames: string[] | undefined,
	customIntervalMs: number | undefined,
	theme: Theme,
): WorkingIndicatorOptions | undefined {
	if (customFrames && customFrames.length > 0) {
		return {
			frames: customFrames.map((f) => theme.fg("accent", f)),
			intervalMs: customIntervalMs && customIntervalMs > 0 ? customIntervalMs : 100,
		};
	}

	// Unknown / missing preset name: fall back to braille rather than
	// returning undefined. The framework's behaviour for
	// `setWorkingIndicator(undefined)` is "restore default", but if the
	// loader does not interpret it that way, a typo in the config would
	// silently blank the spinner.
	const preset = findPreset(presetName) ?? PRESETS[0];
	if (!preset) return undefined; // no presets shipped - shouldn't happen

	const frames = preset.rawFrames.map((frame, i) => {
		const key = preset.colorKeys[i % preset.colorKeys.length] ?? "accent";
		return theme.fg(key as Parameters<Theme["fg"]>[0], frame);
	});
	return { frames, intervalMs: preset.intervalMs };
}

/** Default message list, used when the user has not supplied their own. */
export const DEFAULT_MESSAGES: readonly string[] = [
	"Thinking...",
	"Pondering...",
	"Brewing ideas...",
	"Crunching tokens...",
	"Reading the source...",
	"Polishing neurons...",
	"Aligning bits...",
];

/**
 * Apply theme color to a message. Uses `muted` so messages read as
 * informational rather than alarming, but still visible.
 */
export function themeMessage(message: string, theme: Theme): string {
	return theme.fg("muted", message);
}
