import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { PRESET_NAMES } from "./constants.ts";
import { buildIndicator, findPreset, PRESETS, resolveAnimation } from "./presets.ts";

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
		const indicator = buildIndicator({ preset: "hidden", customs: [] }, theme);
		assert.ok(indicator);
		assert.deepEqual(indicator.frames, []);
	});

	it("returns a single static-dot frame", () => {
		const indicator = buildIndicator({ preset: "dot", customs: [] }, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 1);
		assert.match(indicator.frames[0] ?? "", /●/);
	});

	it("still returns 10 braille frames", () => {
		const indicator = buildIndicator({ preset: "braille", customs: [] }, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 10);
	});

	it("returns shipped frame counts for line, arc, star, box, hamburger, and point", () => {
		assert.equal(buildIndicator({ preset: "line", customs: [] }, theme)?.frames.length, 4);
		assert.equal(buildIndicator({ preset: "arc", customs: [] }, theme)?.frames.length, 6);
		assert.equal(buildIndicator({ preset: "star", customs: [] }, theme)?.frames.length, 6);
		assert.equal(buildIndicator({ preset: "box", customs: [] }, theme)?.frames.length, 4);
		assert.equal(buildIndicator({ preset: "hamburger", customs: [] }, theme)?.frames.length, 3);
		assert.equal(buildIndicator({ preset: "point", customs: [] }, theme)?.frames.length, 5);
	});

	it("uses the named custom when preset matches", () => {
		const indicator = buildIndicator(
			{ preset: "wave", customs: [{ name: "wave", frames: ["x"], intervalMs: 80 }] },
			theme,
		);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 1);
		assert.match(indicator.frames[0] ?? "", /x/);
		assert.equal(indicator.intervalMs, 80);
	});

	it("falls back to braille for unknown names, never hidden", () => {
		const indicator = buildIndicator({ preset: "nope", customs: [] }, theme);
		assert.ok(indicator);
		assert.equal(indicator.frames.length, 10);
	});
});

describe("resolveAnimation", () => {
	it("labels a custom with its name and accent colors", () => {
		const anim = resolveAnimation({
			preset: "wave",
			customs: [{ name: "wave", frames: ["~", "≈"], intervalMs: 80 }],
		});
		assert.equal(anim.kind, "custom");
		assert.equal(anim.name, "wave");
		assert.equal(anim.label, "wave");
		assert.deepEqual(anim.frames, ["~", "≈"]);
		assert.deepEqual(anim.colorKeys, ["accent"]);
	});

	it("labels a builtin with the shipped label", () => {
		const anim = resolveAnimation({ preset: "dots", customs: [] });
		assert.equal(anim.kind, "builtin");
		assert.equal(anim.label, "Dots pulse");
	});

	it("does not select a custom name missing from the registry", () => {
		const anim = resolveAnimation({ preset: "wave", customs: [] });
		assert.equal(anim.name, "braille");
		assert.equal(anim.kind, "builtin");
	});
});
