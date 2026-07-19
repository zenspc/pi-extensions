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
	isKnownPreset,
	loadConfigFromPaths,
	mergeSpinnerConfig,
	parseUserSpinnerConfig,
	readConfigFile,
	sanitizeFrame,
	sanitizeMessage,
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
		assert.equal(sanitizeFrame("toolong"), undefined); // > MAX_FRAME_LENGTH after clean
		assert.equal(sanitizeFrame("abcd"), "abcd");
	});
});

describe("isKnownPreset", () => {
	it("accepts built-ins only", () => {
		assert.equal(isKnownPreset("braille"), true);
		assert.equal(isKnownPreset("rainbow"), true);
		assert.equal(isKnownPreset("custom"), false);
		assert.equal(isKnownPreset("nope"), false);
		assert.equal(isKnownPreset(""), false);
		assert.equal(isKnownPreset(1), false);
	});
});

describe("parseUserSpinnerConfig", () => {
	it("keeps valid fields", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "dots",
			messages: ["One", "Two"],
			cycleIntervalMs: 3000,
			customFrames: ["⠋", "⠙"],
			customIntervalMs: 80,
		});
		assert.deepEqual(parsed, {
			preset: "dots",
			messages: ["One", "Two"],
			cycleIntervalMs: 3000,
			customFrames: ["⠋", "⠙"],
			customIntervalMs: 80,
		});
	});

	it("drops unknown presets, junk keys, and invalid types", () => {
		const parsed = parseUserSpinnerConfig({
			preset: "not-a-real-preset",
			messages: ["ok", 3, "", "\u001b[31m", "also ok"],
			cycleIntervalMs: "fast",
			customFrames: ["ab", "toolongframe", 9, "●"],
			evil: true,
			__proto__: { polluted: true },
			customized: true,
		});
		assert.equal(parsed.preset, undefined);
		assert.deepEqual(parsed.messages, ["ok", "also ok"]);
		assert.equal(parsed.cycleIntervalMs, undefined);
		assert.deepEqual(parsed.customFrames, ["ab", "●"]);
		assert.equal(Object.hasOwn(parsed, "evil"), false);
		assert.equal(Object.hasOwn(parsed, "customized"), false);
		assert.equal((Object.prototype as { polluted?: unknown }).polluted, undefined);
	});

	it("clamps intervals", () => {
		assert.equal(parseUserSpinnerConfig({ cycleIntervalMs: 10 }).cycleIntervalMs, LIMITS.MIN_INTERVAL_MS);
		assert.equal(parseUserSpinnerConfig({ cycleIntervalMs: 999_999 }).cycleIntervalMs, LIMITS.MAX_INTERVAL_MS);
		assert.equal(
			parseUserSpinnerConfig({ customIntervalMs: 1 }).customIntervalMs,
			LIMITS.MIN_FRAME_INTERVAL_MS,
		);
		assert.equal(
			parseUserSpinnerConfig({ customIntervalMs: 50_000 }).customIntervalMs,
			LIMITS.MAX_FRAME_INTERVAL_MS,
		);
	});

	it("caps message and frame counts", () => {
		const messages = Array.from({ length: LIMITS.MAX_MESSAGES + 20 }, (_, i) => `m${i}`);
		const frames = Array.from({ length: LIMITS.MAX_CUSTOM_FRAMES + 10 }, () => "·");
		const parsed = parseUserSpinnerConfig({ messages, customFrames: frames });
		assert.equal(parsed.messages?.length, LIMITS.MAX_MESSAGES);
		assert.equal(parsed.customFrames?.length, LIMITS.MAX_CUSTOM_FRAMES);
	});

	it("returns empty for non-objects", () => {
		assert.deepEqual(parseUserSpinnerConfig(null), {});
		assert.deepEqual(parseUserSpinnerConfig([]), {});
		assert.deepEqual(parseUserSpinnerConfig("x"), {});
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
});

describe("readConfigFile / writeConfigFile / deleteConfigFile", () => {
	it("round-trips a clean config with mode 0o600", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, {
				preset: "bars",
				messages: ["A", "B"],
				cycleIntervalMs: 4000,
			});
			assert.equal(result.ok, true);
			const st = lstatSync(path);
			assert.ok(st.isFile());
			// mode bits may be masked by umask; at least owner-read should be set and group/other write off ideally.
			assert.equal(st.mode & 0o200, 0o200);

			const loaded = readConfigFile(path);
			assert.deepEqual(loaded, {
				preset: "bars",
				messages: ["A", "B"],
				cycleIntervalMs: 4000,
			});

			// No runtime-only fields leaked into the file.
			const raw = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(raw.customized, undefined);

			const del = deleteConfigFile(path);
			assert.equal(del.deleted, true);
			assert.equal(readConfigFile(path), undefined);
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
			// Target file must remain untouched.
			assert.equal(JSON.parse(readFileSync(target, "utf8")).preset, "dots");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strips hostile content when saving", () => {
		const dir = tempDir();
		const path = join(dir, "spinner.json");
		try {
			const result = writeConfigFile(path, {
				preset: "nope",
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
			// No files → defaults, not customized
			const plain = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(plain.customized, false);
			assert.equal(plain.preset, "braille");

			writeConfigFile(globalPath, { preset: "dots", messages: ["G1", "G2"], cycleIntervalMs: 6000 });
			const globalOnly = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(globalOnly.customized, true);
			assert.equal(globalOnly.preset, "dots");
			assert.deepEqual(globalOnly.messages, ["G1", "G2"]);
			assert.equal(globalOnly.cycleIntervalMs, 6000);

			writeConfigFile(projectPath, { preset: "rainbow" });
			const both = loadConfigFromPaths(globalPath, projectPath);
			assert.equal(both.customized, true);
			assert.equal(both.preset, "rainbow");
			// Project did not override messages → global messages remain
			assert.deepEqual(both.messages, ["G1", "G2"]);
			assert.equal(both.cycleIntervalMs, 6000);
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
