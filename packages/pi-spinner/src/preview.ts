import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildIndicator, findPreset } from "./presets.ts";

export type PresetPreview = {
	readonly name: string;
	readonly label: string;
	readonly frames: readonly string[];
	readonly intervalMs: number;
	readonly index: number;
};

export function createPresetPreview(name: string, theme: Theme): PresetPreview | null {
	const preset = findPreset(name);
	if (!preset) return null;
	const indicator = buildIndicator(preset.name, [], undefined, theme);
	return {
		name: preset.name,
		label: preset.label,
		frames: indicator?.frames ?? [],
		intervalMs: preset.intervalMs,
		index: 0,
	};
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
