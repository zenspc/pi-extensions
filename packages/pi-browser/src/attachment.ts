import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

export const CDP_PORT = 9222;
export const CHROME_START_COMMAND = "google-chrome --remote-debugging-port=9222";

const PROBE_TIMEOUT_MS = 2000;

export class MissingDebugPortError extends Error {
	constructor(port: number, cause?: unknown) {
		super(
			`No Chrome debug port found at http://127.0.0.1:${port}. Start Chrome with its remote debugging port: ${CHROME_START_COMMAND}`,
		);
		this.name = "MissingDebugPortError";
		this.cause = cause;
	}
}

type Attached = { kind: "connected"; browser: Browser; tab: Page };
type Detached = { kind: "disconnected"; reason?: unknown };
type AttachmentState = Detached | Attached;

export type ConnectOverCDP = (endpointURL: string) => Promise<Browser>;

async function defaultConnectOverCDP(endpointURL: string): Promise<Browser> {
	return chromium.connectOverCDP(endpointURL);
}

function isConnectionClosed(error: unknown): boolean {
	return /closed|disconnected|connection/i.test(
		error instanceof Error ? error.message : String(error),
	);
}

async function probeDebugEndpoint(port: number): Promise<void> {
	let response: Response;
	try {
		response = await fetch(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
	} catch (error) {
		throw new MissingDebugPortError(port, error);
	}
	if (!response.ok) {
		throw new MissingDebugPortError(port, new Error(`HTTP ${response.status}`));
	}
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

export function createAttachment(options?: {
	port?: number;
	connectOverCDP?: ConnectOverCDP;
}) {
	const port = options?.port ?? CDP_PORT;
	const connectOverCDP = options?.connectOverCDP ?? defaultConnectOverCDP;
	let state: AttachmentState = { kind: "disconnected" };

	async function attach(): Promise<Attached> {
		await probeDebugEndpoint(port);
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
