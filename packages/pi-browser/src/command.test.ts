import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyBrowserCommand,
	formatBrowserHelp,
	formatBrowserStatus,
	parseBrowserCommand,
} from "./command.ts";

describe("parseBrowserCommand", () => {
	it("treats empty args as status", () => {
		assert.deepEqual(parseBrowserCommand(""), { action: "status" });
		assert.deepEqual(parseBrowserCommand("   "), { action: "status" });
	});

	it("parses on / off / status / help", () => {
		assert.deepEqual(parseBrowserCommand("on"), { action: "on" });
		assert.deepEqual(parseBrowserCommand("OFF"), { action: "off" });
		assert.deepEqual(parseBrowserCommand("status"), { action: "status" });
		assert.deepEqual(parseBrowserCommand("help"), { action: "help" });
	});

	it("aliases enable and disable", () => {
		assert.deepEqual(parseBrowserCommand("enable"), { action: "on" });
		assert.deepEqual(parseBrowserCommand("DISABLE"), { action: "off" });
	});

	it("rejects unknown tokens", () => {
		assert.deepEqual(parseBrowserCommand("maybe"), {
			action: "unknown",
			token: "maybe",
		});
		assert.deepEqual(parseBrowserCommand("on please"), {
			action: "unknown",
			token: "on please",
		});
	});
});

describe("applyBrowserCommand", () => {
	it("sets on/off without a toggle", () => {
		assert.deepEqual(applyBrowserCommand({ action: "on" }, false), {
			available: true,
			changed: true,
			kind: "set",
		});
		assert.deepEqual(applyBrowserCommand({ action: "on" }, true), {
			available: true,
			changed: false,
			kind: "set",
		});
		assert.deepEqual(applyBrowserCommand({ action: "off" }, true), {
			available: false,
			changed: true,
			kind: "set",
		});
		assert.deepEqual(applyBrowserCommand({ action: "off" }, false), {
			available: false,
			changed: false,
			kind: "set",
		});
	});

	it("status and help do not change Tool Availability", () => {
		assert.deepEqual(applyBrowserCommand({ action: "status" }, true), {
			available: true,
			changed: false,
			kind: "status",
		});
		assert.deepEqual(applyBrowserCommand({ action: "help" }, false), {
			available: false,
			changed: false,
			kind: "help",
		});
		assert.deepEqual(applyBrowserCommand({ action: "unknown", token: "x" }, true), {
			available: true,
			changed: false,
			kind: "help",
		});
	});
});

describe("formatBrowserStatus / formatBrowserHelp", () => {
	it("reports on or off", () => {
		assert.match(formatBrowserStatus(true), /\bon\b/);
		assert.match(formatBrowserStatus(false), /\boff\b/);
		assert.match(formatBrowserStatus(true), /Tool Availability/);
	});

	it("lists subcommands", () => {
		const help = formatBrowserHelp();
		assert.match(help, /\/browser/);
		assert.match(help, /\bon\b/);
		assert.match(help, /\boff\b/);
		assert.match(help, /status/);
		assert.match(help, /help/);
	});
});
