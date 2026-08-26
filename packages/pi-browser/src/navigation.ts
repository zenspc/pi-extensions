import type { Page, Request, Route } from "playwright-core";
import { classifyUrl } from "./domains.ts";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export function destinationAllowed(url: URL, allowed: ReadonlySet<string>): boolean {
	const classified = classifyUrl(url);
	if (classified.kind === "blank") return true;
	if (classified.kind === "site") return allowed.has(classified.domain);
	return false;
}

export function redirectTarget(
	requestUrl: string,
	status: number,
	location: string | undefined,
): URL | undefined {
	if (!REDIRECT_STATUS.has(status) || !location) return undefined;
	try {
		return new URL(location, requestUrl);
	} catch {
		return undefined;
	}
}

export function createNavigationGuard(allowed: Set<string>) {
	const installed = new WeakSet<Page>();
	let restoreUrl: string | undefined;
	let blockedDomain: string | undefined;

	function noteAbort(domain: string): void {
		if (restoreUrl !== undefined) blockedDomain = domain;
	}

	async function deny(route: Route, domain: string): Promise<void> {
		noteAbort(domain);
		await route.fulfill({ status: 204, body: "" });
	}

	async function handle(tab: Page, route: Route): Promise<void> {
		const request = route.request();
		if (!isTopLevelNavigation(request, tab)) {
			await route.continue();
			return;
		}
		let url: URL;
		try {
			url = new URL(request.url());
		} catch {
			await deny(route, request.url());
			return;
		}
		if (!destinationAllowed(url, allowed)) {
			await deny(route, blockedName(url));
			return;
		}
		try {
			const response = await route.fetch({ maxRedirects: 0 });
			const target = redirectTarget(
				request.url(),
				response.status(),
				response.headers()["location"],
			);
			if (target && !destinationAllowed(target, allowed)) {
				await deny(route, blockedName(target));
				return;
			}
			await route.fulfill({ response });
		} catch {
			try {
				await route.abort("failed");
			} catch {}
		}
	}

	return {
		begin(url: string): void {
			restoreUrl = url;
			blockedDomain = undefined;
		},
		async ensureInstalled(tab: Page): Promise<void> {
			if (installed.has(tab)) return;
			await tab.route("**/*", (route) => handle(tab, route));
			installed.add(tab);
		},
		async finish(tab: Page): Promise<void> {
			const restore = restoreUrl;
			const blocked = blockedDomain;
			restoreUrl = undefined;
			blockedDomain = undefined;
			if (blocked === undefined) return;
			if (restore !== undefined) {
				try {
					await tab.goto(restore, { waitUntil: "load" });
				} catch {}
			}
			throw new Error(`pi-browser blocked navigation to ${blocked}.`);
		},
	};
}

const EMBED_DEST = new Set(["iframe", "embed", "frame", "object"]);

function isTopLevelNavigation(request: Request, tab: Page): boolean {
	if (!request.isNavigationRequest()) return false;
	const dest = request.headers()["sec-fetch-dest"];
	if (dest && EMBED_DEST.has(dest)) return false;
	if (dest === "document") return true;
	return request.frame() === tab.mainFrame();
}

function blockedName(url: URL): string {
	const classified = classifyUrl(url);
	if (classified.kind === "site") return classified.domain;
	return url.host || url.href;
}
