import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import {
	launchDedicatedChrome,
	waitForDebugPort,
	type LaunchSpec,
	type SpawnChrome,
} from "./launch.ts";
import { resolveChromeBinary, resolveUserDataDir } from "./resolve.ts";

type Attached = { kind: "connected"; browser: Browser; tab: Page };
type Detached = { kind: "disconnected"; reason?: unknown };
type AttachmentState = Detached | Attached;

export type ConnectOverCDP = (endpointURL: string) => Promise<Browser>;

export type CreateAttachmentOptions = {
	userDataDir?: string;
	chromeBin?: string;
	extraArgs?: readonly string[];
	connectOverCDP?: ConnectOverCDP;
	launchChrome?: (spec: LaunchSpec) => void;
	waitForPort?: (userDataDir: string) => Promise<number>;
	spawnChrome?: SpawnChrome;
};

async function defaultConnectOverCDP(endpointURL: string): Promise<Browser> {
	return chromium.connectOverCDP(endpointURL);
}

function isConnectionClosed(error: unknown): boolean {
	return /closed|disconnected|connection/i.test(
		error instanceof Error ? error.message : String(error),
	);
}

async function findOwnedTab(browser: Browser): Promise<Page | undefined> {
	for (const context of browser.contexts()) {
		for (const page of context.pages()) {
			try {
				if (await page.evaluate(() => (window as any).__piBrowserOwned === true)) {
					return page;
				}
			} catch {
				continue;
			}
		}
	}
	return undefined;
}

async function openAutomationTab(browser: Browser): Promise<Page> {
	const owned = await findOwnedTab(browser);
	if (owned) return owned;
	const context = browser.contexts()[0] ?? (await browser.newContext());
	const tab = await context.newPage();
	await tab.addInitScript(() => {
		(window as any).__piBrowserOwned = true;
	});
	await tab.evaluate(() => {
		(window as any).__piBrowserOwned = true;
	});
	return tab;
}

export function createAttachment(options?: CreateAttachmentOptions) {
	const connectOverCDP = options?.connectOverCDP ?? defaultConnectOverCDP;
	const launchChrome =
		options?.launchChrome ??
		((spec: LaunchSpec) => {
			launchDedicatedChrome(spec, options?.spawnChrome);
		});
	const waitForPort =
		options?.waitForPort ?? ((userDataDir: string) => waitForDebugPort(userDataDir));
	let state: AttachmentState = { kind: "disconnected" };

	async function attach(): Promise<Attached> {
		const userDataDir = options?.userDataDir ?? resolveUserDataDir();
		const chromeBin = options?.chromeBin ?? resolveChromeBinary();
		launchChrome({
			chromeBin,
			userDataDir,
			extraArgs: options?.extraArgs,
		});
		const port = await waitForPort(userDataDir);
		const browser = await connectOverCDP(`http://127.0.0.1:${port}`);
		const tab = await openAutomationTab(browser);
		state = { kind: "connected", browser, tab };
		return state;
	}

	async function withTab<T>(fn: (tab: Page) => Promise<T>): Promise<T> {
		let attached = state;
		if (attached.kind === "disconnected") {
			attached = await attach();
		}
		try {
			return await fn(attached.tab);
		} catch (error) {
			if (!isConnectionClosed(error)) throw error;
			state = { kind: "disconnected", reason: error };
			throw error;
		}
	}

	async function close(): Promise<void> {
		const current = state;
		state = { kind: "disconnected" };
		if (current.kind !== "connected") return;
		try {
			await current.browser.close();
		} catch {
			return;
		}
	}

	return {
		withTab,
		close,
		get isAttached() {
			return state.kind === "connected";
		},
	};
}
