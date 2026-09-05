import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	advancePreview,
	createPresetPreview,
	formatPreviewHeader,
	previewGlyph,
	previewTickMs,
} from "./preview.ts";

const theme = {
	fg: (key: string, text: string) => `[${key}]${text}`,
} as unknown as Theme;

describe("createPresetPreview", () => {
	it("returns null for unknown names and Back", () => {
		assert.equal(createPresetPreview("nope", theme), null);
		assert.equal(createPresetPreview("__back__", theme), null);
	});

	it("uses the preset's own frames, never a custom-frame override", () => {
		const preview = createPresetPreview("hidden", theme);
		assert.ok(preview);
		assert.deepEqual(preview.frames, []);
		assert.equal(preview.label, "Hidden");
	});

	it("themes dots the same way the live indicator does", () => {
		const preview = createPresetPreview("dots", theme);
		assert.ok(preview);
		assert.equal(preview.frames.length, 4);
		assert.equal(preview.index, 0);
		assert.match(preview.frames[0] ?? "", /·/);
	});
});

describe("advancePreview / previewGlyph / previewTickMs", () => {
	it("wraps frame index and leaves empty presets still", () => {
		const dots = createPresetPreview("dots", theme);
		assert.ok(dots);
		let next = dots;
		for (let i = 0; i < dots.frames.length; i++) next = advancePreview(next);
		assert.equal(next.index, 0);
		assert.equal(previewGlyph(dots), dots.frames[0]);

		const hidden = createPresetPreview("hidden", theme);
		assert.ok(hidden);
		assert.equal(advancePreview(hidden), hidden);
		assert.equal(previewGlyph(hidden), "");
	});

	it("ticks only when there are two or more frames", () => {
		assert.equal(previewTickMs(createPresetPreview("dots", theme)), 140);
		assert.equal(previewTickMs(createPresetPreview("dot", theme)), null);
		assert.equal(previewTickMs(createPresetPreview("hidden", theme)), null);
		assert.equal(previewTickMs(null), null);
	});
});

describe("formatPreviewHeader", () => {
	it("keeps the glyph un-muted so rainbow colors stay visible", () => {
		const preview = createPresetPreview("braille", theme);
		assert.ok(preview);
		const line = formatPreviewHeader(preview, theme);
		assert.match(line, /\[muted\]  preview  /);
		assert.ok(line.includes(preview.frames[0] ?? "missing"));
		assert.match(line, /\[muted\]  Braille spinner/);
	});

	it("renders hidden without a blank-looking glyph hole", () => {
		const preview = createPresetPreview("hidden", theme);
		assert.ok(preview);
		assert.equal(formatPreviewHeader(preview, theme), "[muted]  preview  Hidden");
	});
});
