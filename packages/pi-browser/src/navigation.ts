import type { CDPSession, Page } from "playwright-core";
import { classifyUrl } from "./domains.ts";

type PausedNavigation = { requestId: string; frameId: string; request: { url: string } };

export function destinationAllowed(url: URL, allowed: ReadonlySet<string>): boolean {
	const classified = classifyUrl(url);
	if (classified.kind === "blank") return true;
	return classified.kind === "site" && allowed.has(classified.domain);
}

function blockedName(raw: string): string {
	try {
		const url = new URL(raw);
		const classified = classifyUrl(url);
		return classified.kind === "site" ? classified.domain : url.host || url.href;
	} catch {
		return raw;
	}
}

export function createNavigationGuard(allowed: Set<string>) {
	const installed = new WeakMap<Page, Promise<void>>();
	let restoreUrl: string | undefined;
	let blockedDomain: string | undefined;

	async function install(tab: Page): Promise<void> {
		const cdp = await tab.context().newCDPSession(tab);
		try {
			const { frameTree } = await cdp.send("Page.getFrameTree");
			const mainFrameId = frameTree.frame.id;
			cdp.on("Fetch.requestPaused", (event: PausedNavigation) => {
				void handle(cdp, mainFrameId, event).catch(async () => {
					if (restoreUrl !== undefined) blockedDomain = blockedName(event.request.url);
					await cdp
						.send("Fetch.failRequest", {
							requestId: event.requestId,
							errorReason: "BlockedByClient",
						})
						.catch(() => undefined);
				});
			});
			await cdp.send("Network.enable");
			await cdp.send("Network.setBypassServiceWorker", { bypass: true });
			// Inspect each redirect in Chrome's own network stack without proxying or buffering responses.
			await cdp.send("Fetch.enable", {
				patterns: [{ resourceType: "Document", requestStage: "Request" }],
			});
			tab.once("close", () => {
				void cdp.detach().catch(() => undefined);
			});
		} catch (error) {
			await cdp.detach().catch(() => undefined);
			throw error;
		}
	}

	async function handle(
		cdp: CDPSession,
		mainFrameId: string,
		event: PausedNavigation
	): Promise<void> {
		const { requestId } = event;
		if (event.frameId !== mainFrameId) {
			await cdp.send("Fetch.continueRequest", { requestId });
			return;
		}
		let permitted = false;
		try {
			permitted = destinationAllowed(new URL(event.request.url), allowed);
		} catch {}
		if (permitted) {
			await cdp.send("Fetch.continueRequest", { requestId });
		} else {
			if (restoreUrl !== undefined) blockedDomain = blockedName(event.request.url);
			// A 204 prevents commit without replacing the current document with Chrome's error page.
			await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 204, body: "" });
		}
	}

	return {
		begin(url: string): void {
			restoreUrl = url;
			blockedDomain = undefined;
		},
		async ensureInstalled(tab: Page): Promise<void> {
			let installation = installed.get(tab);
			if (!installation) {
				installation = install(tab).catch((error) => {
					installed.delete(tab);
					throw error;
				});
				installed.set(tab, installation);
			}
			await installation;
		},
		async finish(tab: Page): Promise<void> {
			const restore = restoreUrl;
			const current = new URL(tab.url());
			const blocked =
				blockedDomain ??
				(destinationAllowed(current, allowed) ? undefined : blockedName(current.href));
			restoreUrl = undefined;
			blockedDomain = undefined;
			if (blocked === undefined) return;
			const safeRestore =
				restore && destinationAllowed(new URL(restore), allowed) ? restore : "about:blank";
			if (tab.url() !== safeRestore) {
				try {
					await tab.goto(safeRestore, { waitUntil: "domcontentloaded" });
				} catch {}
			}
			throw new Error(`pi-browser blocked navigation to ${blocked}.`);
		},
	};
}
