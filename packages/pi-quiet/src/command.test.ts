import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyQuietCommand,
	formatQuietHelp,
	formatQuietStatus,
	parseQuietCommand,
} from "./command.ts";

describe("parseQuietCommand", () => {
	it("treats empty args as toggle", () => {
		assert.deepEqual(parseQuietCommand(""), { action: "toggle" });
		assert.deepEqual(parseQuietCommand("   "), { action: "toggle" });
	});

	it("parses on / off / status / help", () => {
		assert.deepEqual(parseQuietCommand("on"), { action: "on" });
		assert.deepEqual(parseQuietCommand("OFF"), { action: "off" });
		assert.deepEqual(parseQuietCommand("status"), { action: "status" });
		assert.deepEqual(parseQuietCommand("help"), { action: "help" });
	});

	it("rejects unknown tokens", () => {
		assert.deepEqual(parseQuietCommand("maybe"), {
			action: "unknown",
			token: "maybe",
		});
		assert.deepEqual(parseQuietCommand("on please"), {
			action: "unknown",
			token: "on please",
		});
	});
});

describe("applyQuietCommand", () => {
	it("toggles Sticky Preference", () => {
		assert.deepEqual(applyQuietCommand({ action: "toggle" }, true), {
			enabled: false,
			changed: true,
			kind: "set",
		});
		assert.deepEqual(applyQuietCommand({ action: "toggle" }, false), {
			enabled: true,
			changed: true,
			kind: "set",
		});
	});

	it("sets on/off idempotently", () => {
		assert.deepEqual(applyQuietCommand({ action: "on" }, true), {
			enabled: true,
			changed: false,
			kind: "set",
		});
		assert.deepEqual(applyQuietCommand({ action: "on" }, false), {
			enabled: true,
			changed: true,
			kind: "set",
		});
		assert.deepEqual(applyQuietCommand({ action: "off" }, true), {
			enabled: false,
			changed: true,
			kind: "set",
		});
	});

	it("status and help do not change preference", () => {
		assert.deepEqual(applyQuietCommand({ action: "status" }, true), {
			enabled: true,
			changed: false,
			kind: "status",
		});
		assert.deepEqual(applyQuietCommand({ action: "help" }, false), {
			enabled: false,
			changed: false,
			kind: "help",
		});
		assert.deepEqual(applyQuietCommand({ action: "unknown", token: "x" }, true), {
			enabled: true,
			changed: false,
			kind: "help",
		});
	});
});

describe("formatQuietStatus / formatQuietHelp", () => {
	it("names Quiet Display vs Stock Display", () => {
		const on = formatQuietStatus(true, "/tmp/quiet.json");
		assert.match(on, /Quiet Display/i);
		assert.match(on, /on/i);
		assert.match(on, /\/tmp\/quiet\.json/);

		const off = formatQuietStatus(false, "/tmp/quiet.json");
		assert.match(off, /Stock Display/i);
		assert.match(off, /off/i);
	});

	it("lists subcommands", () => {
		const help = formatQuietHelp("/tmp/quiet.json");
		assert.match(help, /\/quiet/);
		assert.match(help, /\bon\b/);
		assert.match(help, /\boff\b/);
		assert.match(help, /status/);
		assert.match(help, /\/tmp\/quiet\.json/);
	});
});
