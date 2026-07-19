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
	"minimal",
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
