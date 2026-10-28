import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, CDPSession, Page } from "playwright-core";
import { acquireLease } from "./lease.ts";
import {
	launchDedicatedChrome,
	waitForDebugPort,
	type LaunchSpec,
	type SpawnChrome,
} from "./launch.ts";
import {
	clearStaleLock,
	inspectOccupancy,
	LiveChromeWithoutDebugError,
	type DirOccupancy,
} from "./occupancy.ts";
import { resolveChromeBinary, resolveUserDataDir } from "./resolve.ts";
import { writeJsonAtomic } from "./storage.ts";

type Attached = { browser: Browser; tab: Page; control: CDPSession };
export type ConnectOverCDP = (endpointURL: string) => Promise<Browser>;
export type CreateAttachmentOptions = {
	userDataDir?: string;
	chromeBin?: string;
	extraArgs?: readonly string[];
	timeoutMs?: number;
	connectOverCDP?: ConnectOverCDP;
	launchChrome?: (spec: LaunchSpec) => void | Promise<void>;
	waitForPort?: (userDataDir: string) => Promise<number>;
	spawnChrome?: SpawnChrome;
	inspectOccupancy?: (userDataDir: string) => Promise<DirOccupancy>;
	clearStaleLock?: (userDataDir: string) => void;
	acquireLease?: typeof acquireLease;
};

const TARGET_FILE = "pi-browser-target.json";

async function targetId(tab: Page): Promise<string> {
	const cdp = await tab.context().newCDPSession(tab);
	try {
		return (await cdp.send("Target.getTargetInfo")).targetInfo.targetId;
	} finally {
		await cdp.detach();
	}
}

async function openAutomationTab(browser: Browser, userDataDir: string): Promise<Page> {
	const path = join(userDataDir, TARGET_FILE);
	let ownedId: unknown;
	try {
		ownedId = JSON.parse(readFileSync(path, "utf8")).targetId;
	} catch {}
	if (typeof ownedId === "string") {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				try {
					if (!page.isClosed() && (await targetId(page)) === ownedId) return page;
				} catch {
					if (!page.isClosed())
						throw new Error("Could not identify the saved Automation Tab");
				}
			}
		}
	}
	const context = browser.contexts()[0] ?? (await browser.newContext());
	const tab = await context.newPage();
	try {
		writeJsonAtomic(path, { targetId: await targetId(tab) });
		return tab;
	} catch (error) {
		await tab.close().catch(() => undefined);
		throw error;
	}
}

export function createAttachment(options: CreateAttachmentOptions = {}) {
	const connect =
		options.connectOverCDP ??
		(async (url: string) => {
			const { chromium } = await import("playwright-core");
			return chromium.connectOverCDP(url, { timeout: 30_000 });
		});
	const launch =
		options.launchChrome ??
		(async (spec: LaunchSpec) => {
			const child = launchDedicatedChrome(spec, options.spawnChrome);
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", reject);
			});
		});
	const wait = options.waitForPort ?? waitForDebugPort;
	const inspect =
		options.inspectOccupancy ??
		((dir: string) =>
			inspectOccupancy(dir, options.waitForPort ? { waitForPort: options.waitForPort } : {}));
	let attached: Attached | undefined;
	let release: (() => void) | undefined;
	let pending: Promise<unknown> = Promise.resolve();

	function enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const call = pending.then(fn);
		pending = call.catch(() => undefined);
		return call;
	}

	async function disconnect(): Promise<void> {
		const current = attached;
		attached = undefined;
		try {
			await current?.browser.close();
		} finally {
			release?.();
			release = undefined;
		}
	}

	async function attach(): Promise<Attached> {
		const dir = options.userDataDir ?? resolveUserDataDir();
		release = (options.acquireLease ?? acquireLease)(dir);
		let browser: Browser | undefined;
		try {
			const occupancy = await inspect(dir);
			let port: number;
			if (occupancy.kind === "live-with-debug") {
				port = occupancy.port;
			} else {
				if (occupancy.kind === "live-without-debug")
					throw new LiveChromeWithoutDebugError(dir);
				if (occupancy.kind === "stale-lock")
					(options.clearStaleLock ?? clearStaleLock)(dir);
				await launch({
					chromeBin: options.chromeBin ?? resolveChromeBinary(),
					userDataDir: dir,
					extraArgs: options.extraArgs,
				});
				port = await wait(dir);
			}
			browser = await connect(`http://127.0.0.1:${port}`);
			const tab = await openAutomationTab(browser, dir);
			tab.setDefaultTimeout(options.timeoutMs ?? 30_000);
			tab.setDefaultNavigationTimeout(options.timeoutMs ?? 30_000);
			const control = await tab.context().newCDPSession(tab);
			attached = { browser, tab, control };
			return attached;
		} catch (error) {
			await browser?.close().catch(() => undefined);
			release?.();
			release = undefined;
			throw error;
		}
	}

	async function interrupt(current: Attached): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					// Termination on a freshly attached CDP session can stall behind running script; keep a ready control session.
					await current.control.send("Runtime.terminateExecution");
					await current.control.send("Page.stopLoading");
				})(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 2_000);
				}),
			]);
		} catch {
		} finally {
			clearTimeout(timer);
			await disconnect();
		}
	}

	function withTab<T>(fn: (tab: Page) => Promise<T>, signal?: AbortSignal): Promise<T> {
		return enqueue(async () => {
			signal?.throwIfAborted();
			if (attached && (!attached.browser.isConnected() || attached.tab.isClosed()))
				await disconnect();
			const current = attached ?? (await attach());
			const deadline = AbortSignal.timeout(options.timeoutMs ?? 30_000);
			const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
			let onAbort: (() => void) | undefined;
			try {
				stop.throwIfAborted();
				const aborted = new Promise<never>((_resolve, reject) => {
					onAbort = () => reject(stop.reason);
					stop.addEventListener("abort", onAbort, { once: true });
				});
				return await Promise.race([aborted, fn(current.tab)]);
			} catch (error) {
				if (stop.aborted) await interrupt(current);
				else if (!current.browser.isConnected() || current.tab.isClosed())
					await disconnect();
				throw error;
			} finally {
				if (onAbort) stop.removeEventListener("abort", onAbort);
			}
		});
	}

	return {
		withTab,
		close: () => enqueue(disconnect),
		get isAttached() {
			return (
				attached !== undefined && attached.browser.isConnected() && !attached.tab.isClosed()
			);
		},
	};
}
