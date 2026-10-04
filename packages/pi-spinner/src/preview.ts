import type { Theme } from "@earendil-works/pi-coding-agent";
import type { CustomSpinner } from "./config.ts";
import { buildIndicator, findPreset } from "./presets.ts";

export type PresetPreview = {
	readonly name: string;
	readonly label: string;
	readonly frames: readonly string[];
	readonly intervalMs: number;
	readonly index: number;
};

export function createAnimationPreview(
	cfg: { readonly customs?: readonly CustomSpinner[] },
	name: string,
	theme: Theme,
): PresetPreview | null {
	const customs = cfg.customs ? [...cfg.customs] : [];
	const builtin = findPreset(name);
	if (builtin) {
		const indicator = buildIndicator({ preset: builtin.name, customs: [] }, theme);
		return {
			name: builtin.name,
			label: builtin.label,
			frames: indicator?.frames ?? [],
			intervalMs: builtin.intervalMs,
			index: 0,
		};
	}
	const custom = customs.find((entry) => entry.name === name.toLowerCase());
	if (!custom) return null;
	const indicator = buildIndicator({ preset: custom.name, customs }, theme);
	return {
		name: custom.name,
		label: custom.name,
		frames: indicator?.frames ?? [],
		intervalMs: custom.intervalMs,
		index: 0,
	};
}

export function createPresetPreview(name: string, theme: Theme): PresetPreview | null {
	return createAnimationPreview({ customs: [] }, name, theme);
}

export function advancePreview(preview: PresetPreview): PresetPreview {
	if (preview.frames.length === 0) return preview;
	return { ...preview, index: (preview.index + 1) % preview.frames.length };
}

export function previewGlyph(preview: PresetPreview | null): string {
	if (!preview || preview.frames.length === 0) return "";
	return preview.frames[preview.index] ?? "";
}

export function previewTickMs(preview: PresetPreview | null): number | null {
	if (!preview || preview.frames.length <= 1) return null;
	return preview.intervalMs;
}

export function formatPreviewHeader(preview: PresetPreview | null, theme: Theme): string {
	if (!preview) return theme.fg("muted", "  preview");
	const glyph = previewGlyph(preview);
	if (!glyph) return theme.fg("muted", `  preview  ${preview.label}`);
	return `${theme.fg("muted", "  preview  ")}${glyph}${theme.fg("muted", `  ${preview.label}`)}`;
}
