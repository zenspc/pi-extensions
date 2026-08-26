import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
	DEVTOOLS_ACTIVE_PORT_FILE,
	MissingDebugPortError,
	chromeLaunchArgs,
	launchDedicatedChrome,
	parseDevToolsActivePort,
	readDebugPort,
	waitForDebugPort,
} from "./launch.ts";

describe("chromeLaunchArgs", () => {
	it("points Chrome at the User Data Dir with an ephemeral Debug Port", () => {
		assert.deepEqual(chromeLaunchArgs("/tmp/pi-chrome"), [
			"--user-data-dir=/tmp/pi-chrome",
			"--remote-debugging-port=0",
			"--no-first-run",
			"--no-default-browser-check",
		]);
	});

	it("does not add --headless or a fixed Debug Port", () => {
		const args = chromeLaunchArgs("/tmp/pi-chrome", ["--disable-extensions"]);
		assert.equal(
			args.some((arg) => arg.startsWith("--headless")),
			false,
		);
		assert.equal(args.includes("--remote-debugging-port=9222"), false);
		assert.deepEqual(args.at(-1), "--disable-extensions");
	});
});

describe("parseDevToolsActivePort", () => {
	it("reads the port from the first line", () => {
		assert.equal(parseDevToolsActivePort("54321\n/devtools/browser/abc\n"), 54321);
	});

	it("rejects an empty or non-port first line", () => {
		assert.throws(() => parseDevToolsActivePort(""), /Invalid DevToolsActivePort/);
		assert.throws(() => parseDevToolsActivePort("nope\n"), /Invalid DevToolsActivePort/);
		assert.throws(() => parseDevToolsActivePort("0\n"), /Invalid DevToolsActivePort/);
	});
});

describe("readDebugPort", () => {
	it("reads DevToolsActivePort from the User Data Dir", () => {
		const reads: string[] = [];
		assert.equal(
			readDebugPort("/tmp/profile", (path) => {
				reads.push(path);
				return "61111\n/devtools/browser/x\n";
			}),
			61111,
		);
		assert.deepEqual(reads, [`/tmp/profile/${DEVTOOLS_ACTIVE_PORT_FILE}`]);
	});
});

describe("waitForDebugPort", () => {
	it("returns the port once the file exists and the endpoint answers", async () => {
		let attempts = 0;
		const probed: number[] = [];
		const port = await waitForDebugPort("/tmp/profile", {
			timeoutMs: 1000,
			readFile: () => {
				attempts++;
				if (attempts < 3) throw new Error("not yet");
				return "45000\n/devtools/browser/x\n";
			},
			probe: async (found) => {
				probed.push(found);
			},
			sleep: async () => {},
		});
		assert.equal(port, 45000);
		assert.deepEqual(probed, [45000]);
	});

	it("throws MissingDebugPortError naming the User Data Dir", async () => {
		await assert.rejects(
			waitForDebugPort("/tmp/missing-profile", {
				timeoutMs: 5,
				now: (() => {
					let n = 0;
					return () => (n += 10);
				})(),
				readFile: () => {
					throw new Error("ENOENT");
				},
				sleep: async () => {},
			}),
			(error: unknown) =>
				error instanceof MissingDebugPortError &&
				error.message.includes("/tmp/missing-profile") &&
				!/9222/.test(error.message),
		);
	});
});

describe("launchDedicatedChrome", () => {
	it("spawns headed Chrome detached so it outlives the parent", () => {
		const calls: { bin: string; args: string[]; options: SpawnOptions }[] = [];
		let unrefed = false;
		const child = new EventEmitter() as ChildProcess;
		child.unref = () => {
			unrefed = true;
			return child;
		};

		const returned = launchDedicatedChrome(
			{ chromeBin: "/opt/chrome", userDataDir: "/tmp/pi-chrome" },
			(bin, args, options) => {
				calls.push({ bin, args, options });
				return child;
			},
		);

		assert.equal(returned, child);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].bin, "/opt/chrome");
		assert.deepEqual(calls[0].args, chromeLaunchArgs("/tmp/pi-chrome"));
		assert.equal(calls[0].options.detached, true);
		assert.equal(calls[0].options.stdio, "ignore");
		assert.equal(unrefed, true);
	});
});
