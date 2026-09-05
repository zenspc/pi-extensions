import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { PRESET_NAMES } from "./constants.ts";
import { buildIndicator, findPreset, PRESETS } from "./presets.ts";

const theme = {
	fg: (key: string, text: string) => `[${key}]${text}`,
} as unknown as Theme;

describe("findPreset", () => {
	it("resolves hidden and dot", () => {
		assert.ok(findPreset("hidden"));
		assert.ok(findPreset("dot"));
	});

	it("resolves line, arc, star, box, hamburger, and point", () => {
		assert.ok(findPreset("line"));
		assert.ok(findPreset("arc"));
		assert.ok(findPreset("star"));
		assert.ok(findPreset("box"));
		assert.ok(findPreset("hamburger"));
		assert.ok(findPreset("point"));
	});
});

describe("PRESET_NAMES", () => {
	it("stays in lockstep with PRESETS", () => {
		assert.deepEqual(PRESET_NAMES, PRESETS.map((p) => p.name));
	});
});

describe("buildIndicator", () => {
	it("hides the glyph for the hidden preset", () => {
		const indicator = buildIndicator("hidden", [], undefined, theme);
		assert.ok(indicator);
		assert.deepEqual(indicator.frames, []);
	});

	it("returns a single static-dot frame", () => {
		const indicator = buildIndicator("dot", [], undefined, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 1);
		assert.match(indicator.frames[0] ?? "", /●/);
	});

	it("still returns 10 braille frames", () => {
		const indicator = buildIndicator("braille", [], undefined, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 10);
	});

	it("returns shipped frame counts for line, arc, star, box, hamburger, and point", () => {
		assert.equal(buildIndicator("line", [], undefined, theme)?.frames.length, 4);
		assert.equal(buildIndicator("arc", [], undefined, theme)?.frames.length, 6);
		assert.equal(buildIndicator("star", [], undefined, theme)?.frames.length, 6);
		assert.equal(buildIndicator("box", [], undefined, theme)?.frames.length, 4);
		assert.equal(buildIndicator("hamburger", [], undefined, theme)?.frames.length, 3);
		assert.equal(buildIndicator("point", [], undefined, theme)?.frames.length, 5);
	});

	it("prefers non-empty custom frames over hidden", () => {
		const indicator = buildIndicator("hidden", ["x"], 80, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 1);
		assert.match(indicator.frames[0] ?? "", /x/);
	});

	it("falls back to braille for unknown names, never hidden", () => {
		const indicator = buildIndicator("nope", [], undefined, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 10);
	});
});
