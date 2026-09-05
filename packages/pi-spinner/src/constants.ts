/**
 * Shared constants with no peer-package imports so config IO stays unit-testable.
 */

/** Built-in preset names only (no "custom" - that is a frames override). */
export const PRESET_NAMES = [
	"braille",
	"dots",
	"arrows",
	"bars",
	"progress",
	"rainbow",
	"line",
	"arc",
	"star",
	"box",
	"hamburger",
	"point",
	"minimal",
	"dot",
	"hidden",
] as const;

export type BuiltinPresetName = (typeof PRESET_NAMES)[number];

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

export const CYCLE_MODES = ["random", "sequential"] as const;
export type CycleMode = (typeof CYCLE_MODES)[number];

export const MESSAGE_PACK_NAMES = ["default", "calm", "dry"] as const;
export type MessagePackName = (typeof MESSAGE_PACK_NAMES)[number];

export const MESSAGE_PACKS: Record<MessagePackName, readonly string[]> = {
	default: DEFAULT_MESSAGES,
	calm: ["Working...", "Still working...", "One moment...", "Almost..."],
	dry: [
		"Waiting on the model...",
		"Tool call in flight...",
		"Reading files...",
		"Applying a patch...",
		"Sitting tight...",
	],
};
