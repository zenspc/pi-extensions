import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createAttachment } from "./attachment.ts";
import { launchDedicatedChrome, waitForDebugPort } from "./launch.ts";
import {
	LiveChromeWithoutDebugError,
	SINGLETON_LOCK_FILE,
	clearStaleLock,
} from "./occupancy.ts";
import { resolveChromeBinary } from "./resolve.ts";

async function probe(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		return response.ok;
	} catch {
		return false;
	}
}

function killChrome(chrome: ChildProcess | undefined): void {
	if (!chrome?.pid) return;
	try {
		process.kill(-chrome.pid, "SIGTERM");
	} catch {
		try {
			chrome.kill("SIGTERM");
		} catch {
			return;
		}
	}
}

function hasLock(userDataDir: string): boolean {
	try {
		lstatSync(join(userDataDir, SINGLETON_LOCK_FILE));
		return true;
	} catch {
		return false;
	}
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(label);
}

describe("reuse leftover Chrome", () => {
	it("attaches to a live dedicated Chrome and reuses the Automation Tab", async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-reuse-"));
		after(() => rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }));

		const chromeBin = resolveChromeBinary();
		let chrome: ChildProcess | undefined;
		after(() => killChrome(chrome));

		const first = createAttachment({
			userDataDir,
			chromeBin,
			extraArgs: ["--headless=new"],
			launchChrome: (spec) => {
				chrome = launchDedicatedChrome(spec, spawn);
			},
		});

		const marker = await first.withTab(async (tab) => {
			await tab.evaluate(() => {
				(window as any).__piReuse = 7;
			});
			return tab.evaluate(() => (window as any).__piReuse);
		});
		assert.equal(marker, 7);
		await first.close();

		const debugPort = await waitForDebugPort(userDataDir, { timeoutMs: 5_000 });
		assert.equal(await probe(debugPort), true);

		let spawns = 0;
		const second = createAttachment({
			userDataDir,
			chromeBin,
			extraArgs: ["--headless=new"],
			spawnChrome: (bin, args, options) => {
				spawns++;
				return spawn(bin, args, options);
			},
		});

		const reused = await second.withTab(async (tab) => tab.evaluate(() => (window as any).__piReuse));
		assert.equal(reused, 7);
		assert.equal(spawns, 0);
		await second.close();
		assert.equal(await probe(debugPort), true, "Chrome stays up after the second Attachment.close");
	});

	it("fails if live Chrome has no Debug Port and does not spawn another window", async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-live-no-debug-"));
		after(() => rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }));

		const chromeBin = resolveChromeBinary();
		const chrome = spawn(
			chromeBin,
			[
				`--user-data-dir=${userDataDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--headless=new",
			],
			{ detached: true, stdio: "ignore" },
		);
		chrome.unref();
		after(() => killChrome(chrome));

		await waitUntil(
			() => hasLock(userDataDir),
			15_000,
			"SingletonLock never appeared",
		);

		let spawns = 0;
		const attachment = createAttachment({
			userDataDir,
			chromeBin,
			extraArgs: ["--headless=new"],
			spawnChrome: (bin, args, options) => {
				spawns++;
				return spawn(bin, args, options);
			},
			waitForPort: (dir) => waitForDebugPort(dir, { timeoutMs: 1_000 }),
		});

		await assert.rejects(
			attachment.withTab(async () => undefined),
			(error: unknown) =>
				error instanceof LiveChromeWithoutDebugError &&
				error.message.includes(userDataDir) &&
				/quit that window/i.test(error.message),
		);
		assert.equal(spawns, 0);
		assert.equal(hasLock(userDataDir), true);
	});

	it("deletes a stale lock then launches", async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-stale-"));
		after(() => rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }));

		symlinkSync(`${hostname()}-999999999`, join(userDataDir, SINGLETON_LOCK_FILE));
		writeFileSync(join(userDataDir, "DevToolsActivePort"), "59999\n/devtools/browser/stale\n");

		const chromeBin = resolveChromeBinary();
		let chrome: ChildProcess | undefined;
		after(() => killChrome(chrome));

		let cleared = 0;
		const attachment = createAttachment({
			userDataDir,
			chromeBin,
			extraArgs: ["--headless=new"],
			clearStaleLock: (dir) => {
				cleared++;
				clearStaleLock(dir);
			},
			launchChrome: (spec) => {
				chrome = launchDedicatedChrome(spec, spawn);
			},
		});

		await attachment.withTab(async (tab) => tab.evaluate(() => true));
		assert.equal(cleared, 1);
		const debugPort = await waitForDebugPort(userDataDir, { timeoutMs: 5_000 });
		assert.notEqual(debugPort, 59999);
		await attachment.close();
	});
});
