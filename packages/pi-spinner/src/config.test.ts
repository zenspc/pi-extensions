import assert from "node:assert/strict";
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	LIMITS,
	MAX_CONFIG_BYTES,
	defaults,
	deleteConfigFile,
	deleteCustom,
	findCustom,
	isKnownPreset,
	isReservedAnimationName,
	isValidCustomName,
	loadConfigFromPaths,
	mergeSpinnerConfig,
	normalizeAnimation,
	parseUserSpinnerConfig,
	readConfigFile,
	sanitizeFrame,
	sanitizeMessage,
	upsertCustom,
	writeConfigFile,
} from "./config.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-spinner-"));
}

describe("sanitizeMessage / sanitizeFrame", () => {
	it("trims and keeps normal text", () => {
		assert.equal(sanitizeMessage("  Thinking...  "), "Thinking...");
		assert.equal(sanitizeFrame("⠋"), "⠋");
	});

	it("strips ANSI CSI sequences and control characters", () => {
		assert.equal(sanitizeMessage("hi\u001b[31mred\u001b[0m"), "hired");
		assert.equal(sanitizeMessage("a\nb\tc"), "abc");
		assert.equal(sanitizeMessage("x\u0000y\u007fz"), "xyz");
		assert.equal(sanitizeFrame("\u001b[1m●"), "●");
	});

	it("rejects empty / non-string / oversize results", () => {
		assert.equal(sanitizeMessage(""), undefined);
		assert.equal(sanitizeMessage("   "), undefined);
		assert.equal(sanitizeMessage("\u001b[0m"), undefined);
		assert.equal(sanitizeMessage(null), undefined);
		assert.equal(sanitizeMessage(12), undefined);
		const long = "x".repeat(LIMITS.MAX_MESSAGE_LENGTH + 40);
		assert.equal(sanitizeMessage(long)?.length, LIMITS.MAX_MESSAGE_LENGTH);
		assert.equal(sanitizeFrame("abcd"), "abcd");
		assert.equal(sanitizeFrame("▱▱▱▱▱"), "▱▱▱▱▱");
		assert.equal(sanitizeFrame("12345678"), "12345678");
		assert.equal(sanitizeFrame("123456789"), undefined);
	});
});

describe("isKnownPreset", () => {
	it("accepts built-ins only", () => {
		assert.equal(isKnownPreset("braille"), true);
		assert.equal(isKnownPreset("rainbow"), true);
		assert.equal(isKnownPreset("hidden"), true);
		assert.equal(isKnownPreset("dot"), true);
		assert.equal(isKnownPreset("custom"), false);
		assert.equal(isKnownPreset("none"), false);
		assert.equal(isKnownPreset("nope"), false);
		assert.equal(isKnownPreset(""), false);
		assert.equal(isKnownPreset(1), false);
	});
});

describe("custom names", () => {
	it("accepts lowercase identifiers and rejects reserved tokens", () => {
		assert.equal(isValidCustomName("wave"), true);
		assert.equal(isValidCustomName("custom"), true);
		assert.equal(isValidCustomName("a"), true);
		assert.equal(isValidCustomName("blocks-2"), true);
		assert.equal(isValidCustomName("Dots"), false);
		assert.equal(isValidCustomName("dots"), false);
		assert.equal(isValidCustomName("help"), false);
		assert.equal(isValidCustomName("status"), false);
		assert.equal(isValidCustomName("rotate"), false);
		assert.equal(isValidCustomName("reset"), false);
		assert.equal(isValidCustomName("pack"), false);
		assert.equal(isValidCustomName("random"), false);
		assert.equal(isValidCustomName("sequential"), false);
		assert.equal(isValidCustomName("1wave"), false);
		assert.equal(isValidCustomName("Wave"), false);
		assert.equal(isValidCustomName("has_underscore"), false);
		assert.equal(isReservedAnimationName("dots"), true);
		assert.equal(isReservedAnimationName("help"), true);
		assert.equal(isReservedAnimationName("wave"), false);
	});
});

describe("parseUserSpinnerConfig", () => {
	it("keeps valid fields", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "dots",
			customs: [{ name: "wave", frames: ["~", "≈"], intervalMs: 80 }],
			messages: ["One", "Two"],
			messagePack: "calm",
			cycleIntervalMs: 3000,
			cycleMode: "sequential",
			activityMessages: true,
			syncThinkingLabel: true,
		});
		assert.deepEqual(parsed, {
			preset: "dots",
			customs: [{ name: "wave", frames: ["~", "≈"], intervalMs: 80 }],
			messages: ["One", "Two"],
			messagePack: "calm",
			cycleIntervalMs: 3000,
			cycleMode: "sequential",
			activityMessages: true,
			syncThinkingLabel: true,
		});
	});

	it("migrates legacy customFrames into a custom named custom and selects it", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "dots",
			customFrames: ["a", "b"],
		});
		assert.equal(parsed.preset, "custom");
		assert.deepEqual(parsed.customs, [{ name: "custom", frames: ["a", "b"], intervalMs: 100 }]);
		assert.equal(Object.hasOwn(parsed, "customFrames"), false);
		assert.equal(Object.hasOwn(parsed, "customIntervalMs"), false);
	});

	it("uses customIntervalMs when migrating customFrames", () => {
		const parsed = parseUserSpinnerConfig({
			customFrames: ["x"],
			customIntervalMs: 80,
		});
		assert.equal(parsed.preset, "custom");
		assert.deepEqual(parsed.customs, [{ name: "custom", frames: ["x"], intervalMs: 80 }]);
	});

	it("ignores customFrames when customs is present", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "dots",
			customs: [{ name: "wave", frames: ["~"], intervalMs: 80 }],
			customFrames: ["a", "b"],
			customIntervalMs: 50,
		});
		assert.equal(parsed.preset, "dots");
		assert.deepEqual(parsed.customs, [{ name: "wave", frames: ["~"], intervalMs: 80 }]);
	});

	it("persists an empty customs array when the key is present", () => {
		const parsed = parseUserSpinnerConfig({ customs: [] });
		assert.deepEqual(parsed.customs, []);
		assert.equal(parsed.preset, undefined);
	});

	it("drops empty-frame customs and reserved names", () => {
		const parsed = parseUserSpinnerConfig({
			customs: [
				{ name: "empty", frames: [], intervalMs: 80 },
				{ name: "dots", frames: ["x"], intervalMs: 80 },
				{ name: "help", frames: ["x"], intervalMs: 80 },
				{ name: "wave", frames: ["~"], intervalMs: 80 },
			],
		});
		assert.deepEqual(parsed.customs, [{ name: "wave", frames: ["~"], intervalMs: 80 }]);
	});

	it("lowercases custom names and lets the last duplicate win", () => {
		const parsed = parseUserSpinnerConfig({
			customs: [
				{ name: "Wave", frames: ["~"], intervalMs: 80 },
				{ name: "WAVE", frames: ["≈", "~"], intervalMs: 90 },
			],
		});
		assert.deepEqual(parsed.customs, [{ name: "wave", frames: ["≈", "~"], intervalMs: 90 }]);
	});

	it("keeps a custom identifier as preset", () => {
		const parsed = parseUserSpinnerConfig({ preset: "wave" });
		assert.equal(parsed.preset, "wave");
	});

	it("accepts only real booleans for activityMessages", () => {
		assert.equal(parseUserSpinnerConfig({ activityMessages: true }).activityMessages, true);
		assert.equal(parseUserSpinnerConfig({ activityMessages: false }).activityMessages, false);
		assert.equal(parseUserSpinnerConfig({ activityMessages: "true" }).activityMessages, undefined);
		assert.equal(parseUserSpinnerConfig({ activityMessages: 1 }).activityMessages, undefined);
	});

	it("accepts only real booleans for syncThinkingLabel", () => {
		assert.equal(parseUserSpinnerConfig({ syncThinkingLabel: true }).syncThinkingLabel, true);
		assert.equal(parseUserSpinnerConfig({ syncThinkingLabel: false }).syncThinkingLabel, false);
		assert.equal(parseUserSpinnerConfig({ syncThinkingLabel: "yes" }).syncThinkingLabel, undefined);
		assert.equal(parseUserSpinnerConfig({ syncThinkingLabel: 1 }).syncThinkingLabel, undefined);
	});

	it("lowercases cycleMode and messagePack", () => {
		const parsed = parseUserSpinnerConfig({
			cycleMode: "RANDOM",
			messagePack: "CALM",
		});
		assert.equal(parsed.cycleMode, "random");
		assert.equal(parsed.messagePack, "calm");
	});

	it("drops unknown cycleMode and messagePack names", () => {
		const parsed = parseUserSpinnerConfig({
			cycleMode: "shuffle",
			messagePack: "fun",
			messages: ["keep me"],
		});
		assert.equal(parsed.cycleMode, undefined);
		assert.equal(parsed.messagePack, undefined);
		assert.deepEqual(parsed.messages, ["keep me"]);
	});

	it("does not replace messages when parsing messagePack", () => {
		const parsed = parseUserSpinnerConfig({
			messagePack: "calm",
			messages: ["Custom A", "Custom B"],
		});
		assert.equal(parsed.messagePack, "calm");
		assert.deepEqual(parsed.messages, ["Custom A", "Custom B"]);
	});

	it("drops unknown presets, junk keys, and invalid types", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "not a real preset",
			messages: ["ok", 3, "", "\u001b[31m", "also ok"],
			cycleIntervalMs: "fast",
			customs: [{ name: "ab", frames: ["ab", "toolongframe", 9, "●"], intervalMs: 80 }],
			evil: true,
			__proto__: { polluted: true },
			customized: true,
		});
		assert.equal(parsed.preset, undefined);
		assert.deepEqual(parsed.messages, ["ok", "also ok"]);
		assert.equal(parsed.cycleIntervalMs, undefined);
		assert.deepEqual(parsed.customs, [{ name: "ab", frames: ["ab", "●"], intervalMs: 80 }]);
		assert.equal(Object.hasOwn(parsed, "evil"), false);
		assert.equal(Object.hasOwn(parsed, "customized"), false);
		assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
	});

	it("clamps intervals", () => {
		assert.equal(parseUserSpinnerConfig({ cycleIntervalMs: 10 }).cycleIntervalMs, LIMITS.MIN_INTERVAL_MS);
		assert.equal(parseUserSpinnerConfig({ cycleIntervalMs: 999_999 }).cycleIntervalMs, LIMITS.MAX_INTERVAL_MS);
		assert.equal(
			parseUserSpinnerConfig({
				customs: [{ name: "wave", frames: ["~"], intervalMs: 1 }],
			}).customs?.[0]?.intervalMs,
			LIMITS.MIN_FRAME_INTERVAL_MS,
		);
		assert.equal(
			parseUserSpinnerConfig({
				customs: [{ name: "wave", frames: ["~"], intervalMs: 50_000 }],
			}).customs?.[0]?.intervalMs,
			LIMITS.MAX_FRAME_INTERVAL_MS,
		);
		assert.equal(
			parseUserSpinnerConfig({ customFrames: ["x"], customIntervalMs: 1 }).customs?.[0]?.intervalMs,
			LIMITS.MIN_FRAME_INTERVAL_MS,
		);
	});

	it("caps message, frame, and custom spinner counts", () => {
		const messages = Array.from({ length: LIMITS.MAX_MESSAGES + 20 }, (_, i) => `m${i}`);
		const frames = Array.from({ length: LIMITS.MAX_CUSTOM_FRAMES + 10 }, () => "·");
		const customs = Array.from({ length: LIMITS.MAX_CUSTOM_SPINNERS + 5 }, (_, i) => ({
			name: `c${i}`,
			frames: ["·"],
			intervalMs: 100,
		}));
		const parsed = parseUserSpinnerConfig({ messages, customs: [{ name: "wave", frames, intervalMs: 80 }, ...customs] });
		assert.equal(parsed.messages?.length, LIMITS.MAX_MESSAGES);
		assert.equal(parsed.customs?.[0]?.frames.length, LIMITS.MAX_CUSTOM_FRAMES);
		assert.equal(parsed.customs?.length, LIMITS.MAX_CUSTOM_SPINNERS);
	});

	it("returns empty for non-objects", () => {
		assert.deepEqual(parseUserSpinnerConfig(null), {});
		assert.deepEqual(parseUserSpinnerConfig([]), {});
		assert.deepEqual(parseUserSpinnerConfig("x"), {});
	});
});

describe("defaults", () => {
	it("uses random cycle mode and the default pack", () => {
		const d = defaults();
		assert.equal(d.cycleMode, "random");
		assert.equal(d.messagePack, "default");
		assert.equal(d.activityMessages, false);
		assert.equal(d.syncThinkingLabel, false);
		assert.equal(d.hasRotationConfig, false);
		assert.deepEqual(d.customs, []);
		assert.equal(Object.hasOwn(d, "customFrames"), false);
	});
});

describe("normalizeAnimation / registry helpers", () => {
	it("rewrites a dangling custom preset to braille", () => {
		const next = normalizeAnimation({ ...defaults(), preset: "wave" });
		assert.equal(next.preset, "braille");
	});

	it("keeps a custom preset that exists in the registry", () => {
		const next = normalizeAnimation({
			...defaults(),
			preset: "wave",
			customs: [{ name: "wave", frames: ["~"], intervalMs: 80 }],
		});
		assert.equal(next.preset, "wave");
	});

	it("upserts by lowercase name and deletes back to braille when active", () => {
		const first = upsertCustom([], { name: "Wave", frames: ["~"], intervalMs: 80 });
		assert.deepEqual(first, [{ name: "wave", frames: ["~"], intervalMs: 80 }]);
		const second = upsertCustom(first, { name: "WAVE", frames: ["≈"], intervalMs: 90 });
		assert.deepEqual(second, [{ name: "wave", frames: ["≈"], intervalMs: 90 }]);
		assert.equal(findCustom(second, "WAVE")?.intervalMs, 90);
		const deleted = deleteCustom({ ...defaults(), preset: "wave", customs: second }, "wave");
		assert.deepEqual(deleted.customs, []);
		assert.equal(deleted.preset, "braille");
	});
});

describe("mergeSpinnerConfig", () => {
	it("applies overrides without mutating the base", () => {
		const base = defaults();
		const next = mergeSpinnerConfig(base, { preset: "rainbow", messages: ["Hi"] });
		assert.equal(next.preset, "rainbow");
		assert.deepEqual(next.messages, ["Hi"]);
		assert.equal(base.preset, "braille");
		assert.ok(base.messages.length > 1);
	});

	it("ignores empty message overrides", () => {
		const base = defaults();
		const next = mergeSpinnerConfig(base, { messages: [] });
		assert.deepEqual(next.messages, base.messages);
	});

	it("later-wins on customs including an empty array, then normalizes", () => {
		const base = mergeSpinnerConfig(defaults(), {
			preset: "wave",
			customs: [{ name: "wave", frames: ["~"], intervalMs: 80 }],
		});
		assert.equal(base.preset, "wave");
		const hidden = mergeSpinnerConfig(base, { customs: [] });
		assert.deepEqual(hidden.customs, []);
		assert.equal(hidden.preset, "braille");
	});
});

describe("readConfigFile / writeConfigFile / deleteConfigFile", () => {
	it("round-trips a clean config with mode 0o600", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, {
				preset: "bars",
				messages: ["A", "B"],
				messagePack: "dry",
				cycleIntervalMs: 4000,
				cycleMode: "sequential",
				activityMessages: true,
			});
			assert.equal(result.ok, true);
			const st = lstatSync(path);
			assert.ok(st.isFile());
			assert.equal(st.mode & 0o200, 0o200);

			const loaded = readConfigFile(path);
			assert.deepEqual(loaded, {
				preset: "bars",
				messages: ["A", "B"],
				messagePack: "dry",
				cycleIntervalMs: 4000,
				cycleMode: "sequential",
				activityMessages: true,
			});

			const raw = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(raw.customized, undefined);
			assert.equal(raw.customFrames, undefined);
			assert.equal(raw.customIntervalMs, undefined);

			const del = deleteConfigFile(path);
			assert.equal(del.deleted, true);
			assert.equal(readConfigFile(path), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stores two named customs and reloads both", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, {
				preset: "wave",
				customs: [
					{ name: "wave", frames: ["~", "≈", "~"], intervalMs: 80 },
					{ name: "blocks", frames: ["▖", "▘", "▝", "▗"], intervalMs: 90 },
				],
			});
			assert.equal(result.ok, true);
			const loaded = readConfigFile(path);
			assert.equal(loaded?.preset, "wave");
			assert.deepEqual(loaded?.customs, [
				{ name: "wave", frames: ["~", "≈", "~"], intervalMs: 80 },
				{ name: "blocks", frames: ["▖", "▘", "▝", "▗"], intervalMs: 90 },
			]);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(onDisk.customFrames, undefined);
			assert.equal(onDisk.customIntervalMs, undefined);
			assert.equal(onDisk.customs.length, 2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists customs: [] when the key is present", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, { customs: [] });
			assert.equal(result.ok, true);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.deepEqual(onDisk.customs, []);
			assert.deepEqual(readConfigFile(path)?.customs, []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("never writes customFrames or customIntervalMs after a legacy load", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			writeFileSync(path, JSON.stringify({ preset: "dots", customFrames: ["a", "b"], customIntervalMs: 80 }), "utf8");
			const loaded = readConfigFile(path);
			assert.equal(loaded?.preset, "custom");
			assert.deepEqual(loaded?.customs, [{ name: "custom", frames: ["a", "b"], intervalMs: 80 }]);
			const result = writeConfigFile(path, { messages: ["Hi"] });
			assert.equal(result.ok, true);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(onDisk.customFrames, undefined);
			assert.equal(onDisk.customIntervalMs, undefined);
			assert.equal(onDisk.preset, "custom");
			assert.deepEqual(onDisk.customs, [{ name: "custom", frames: ["a", "b"], intervalMs: 80 }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores oversized files", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			writeFileSync(path, `${"x".repeat(MAX_CONFIG_BYTES + 1)}`, "utf8");
			assert.equal(readConfigFile(path), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores invalid JSON and non-objects", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			writeFileSync(path, "{not json", "utf8");
			assert.equal(readConfigFile(path), undefined);
			writeFileSync(path, "[1,2,3]\n", "utf8");
			assert.equal(readConfigFile(path), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses symlinks on read, write, and delete", () => {
		const dir = tempDir();
		const target = join(dir, "target.json");
		const link = join(dir, "spinner.json");
		try {
			writeFileSync(target, JSON.stringify({ preset: "dots" }), "utf8");
			symlinkSync(target, link);
			assert.equal(readConfigFile(link), undefined);

			const write = writeConfigFile(link, { preset: "bars" });
			assert.equal(write.ok, false);

			const del = deleteConfigFile(link);
			assert.equal(del.deleted, false);
			assert.equal(JSON.parse(readFileSync(target, "utf8")).preset, "dots");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists activityMessages false when present", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, { activityMessages: false });
			assert.equal(result.ok, true);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(onDisk.activityMessages, false);
			assert.equal(readConfigFile(path)?.activityMessages, false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists syncThinkingLabel false when present", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, { syncThinkingLabel: false });
			assert.equal(result.ok, true);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(onDisk.syncThinkingLabel, false);
			assert.equal(readConfigFile(path)?.syncThinkingLabel, false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strips hostile content when saving", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, {
				preset: "nope!",
				messages: ["ok", "\u001b[31mRED", "x".repeat(LIMITS.MAX_MESSAGE_LENGTH + 5)],
				// @ts-expect-error intentional junk key
				customized: true,
				// @ts-expect-error intentional junk key
				__proto__: { polluted: true },
			} as never);
			assert.equal(result.ok, true);
			const onDisk = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(onDisk.preset, undefined);
			assert.equal(onDisk.customized, undefined);
			assert.equal(onDisk.messages[0], "ok");
			assert.equal(onDisk.messages[1], "RED");
			assert.equal(onDisk.messages[2].length, LIMITS.MAX_MESSAGE_LENGTH);
			assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("loadConfigFromPaths", () => {
	it("merges defaults < global < project and sets customized", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			const plain = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(plain.customized, false);
			assert.equal(plain.hasRotationConfig, false);
			assert.equal(plain.preset, "braille");

			writeConfigFile(globalPath, {
				preset: "dots",
				messages: ["G1", "G2"],
				cycleIntervalMs: 6000,
			});
			const globalOnly = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(globalOnly.customized, true);
			assert.equal(globalOnly.hasRotationConfig, true);
			assert.equal(globalOnly.preset, "dots");
			assert.deepEqual(globalOnly.messages, ["G1", "G2"]);
			assert.equal(globalOnly.cycleIntervalMs, 6000);

			writeConfigFile(projectPath, { preset: "rainbow", cycleMode: "sequential" });
			const both = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(both.customized, true);
			assert.equal(both.preset, "rainbow");
			assert.deepEqual(both.messages, ["G1", "G2"]);
			assert.equal(both.cycleIntervalMs, 6000);
			assert.equal(both.cycleMode, "sequential");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads old customFrames as preset custom and one customs entry", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeFileSync(globalPath, JSON.stringify({ preset: "dots", customFrames: ["a", "b"] }), "utf8");
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.preset, "custom");
			assert.equal(cfg.customs.length, 1);
			assert.equal(cfg.customs[0]?.name, "custom");
			assert.deepEqual(cfg.customs[0]?.frames, ["a", "b"]);
			assert.equal(cfg.hasRotationConfig, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps global customs when the project file only sets preset", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeConfigFile(globalPath, {
				preset: "wave",
				customs: [{ name: "wave", frames: ["~"], intervalMs: 80 }],
			});
			writeConfigFile(projectPath, { preset: "dots" });
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.preset, "dots");
			assert.equal(cfg.customs.length, 1);
			assert.equal(cfg.customs[0]?.name, "wave");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats a file that only enables activityMessages as customized", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeConfigFile(globalPath, { activityMessages: true });
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.customized, true);
			assert.equal(cfg.activityMessages, true);
			assert.equal(cfg.hasRotationConfig, false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats a file that only enables syncThinkingLabel as customized but not rotating", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeConfigFile(globalPath, { syncThinkingLabel: true });
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.customized, true);
			assert.equal(cfg.syncThinkingLabel, true);
			assert.equal(cfg.hasRotationConfig, false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats a customs key as rotation config", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeConfigFile(globalPath, { customs: [] });
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.customized, true);
			assert.equal(cfg.hasRotationConfig, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats rejected global/project files as absent", () => {
		const dir = tempDir();
		const globalPath = join(dir, "global.json");
		const projectPath = join(dir, "project.json");
		try {
			writeFileSync(globalPath, "{bad", "utf8");
			writeFileSync(projectPath, `${"y".repeat(MAX_CONFIG_BYTES + 2)}`, "utf8");
			const cfg = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(cfg.customized, false);
			assert.equal(cfg.preset, "braille");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
