import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildIndicator, findPreset } from "./presets.ts";

const theme = {
	fg: (key: string, text: string) => `[${key}]${text}`,
} as unknown as Theme;

describe("findPreset", () => {
	it("resolves hidden and dot", () => {
		assert.ok(findPreset("hidden"));
		assert.ok(findPreset("dot"));
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
