import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright-core";
import { Type } from "typebox";
import { browserTool } from "./browser-tool.ts";
import { installDomainGate } from "./gate.ts";
import { createNavigationGuard, destinationAllowed, redirectTarget } from "./navigation.ts";

describe("destinationAllowed", () => {
	const allowed = new Set(["example.com", "127.0.0.1"]);

	it("allows about:blank without a grant", () => {
		assert.equal(destinationAllowed(new URL("about:blank"), allowed), true);
		assert.equal(destinationAllowed(new URL("about:blank#keep"), new Set()), true);
	});

	it("allows a Registrable Domain already in the live set", () => {
		assert.equal(destinationAllowed(new URL("https://a.b.example.com/x"), allowed), true);
		assert.equal(destinationAllowed(new URL("http://example.com:8080/"), allowed), true);
		assert.equal(destinationAllowed(new URL("http://127.0.0.1:9/"), allowed), true);
	});

	it("rejects an unapproved site, a public suffix, and non-http(s)", () => {
		assert.equal(destinationAllowed(new URL("https://evil.test/"), allowed), false);
		assert.equal(destinationAllowed(new URL("https://github.io/"), allowed), false);
		assert.equal(destinationAllowed(new URL("about:srcdoc"), allowed), false);
		assert.equal(destinationAllowed(new URL("file:///tmp/x"), allowed), false);
	});
});

describe("redirectTarget", () => {
	it("resolves an absolute or relative Location on a 3xx", () => {
		assert.equal(
			redirectTarget("https://ok.test/go", 302, "https://evil.test/secret")?.href,
			"https://evil.test/secret",
		);
		assert.equal(redirectTarget("https://ok.test/go", 301, "/next")?.href, "https://ok.test/next");
	});

	it("ignores non-redirects and bad Locations", () => {
		assert.equal(redirectTarget("https://ok.test/go", 200, "https://evil.test/"), undefined);
		assert.equal(redirectTarget("https://ok.test/go", 302, undefined), undefined);
		assert.equal(redirectTarget("https://ok.test/go", 302, "http://[") , undefined);
	});
});

describe("createNavigationGuard", () => {
	it("aborts main-frame hops off the live set and continues iframes and subresources", async () => {
		const allowed = new Set(["ok.test"]);
		const guard = createNavigationGuard(allowed);
		const tab = fakeTab("https://ok.test/start");
		await guard.ensureInstalled(tab.asPage());

		assert.equal(await tab.dispatch("https://ok.test/next", { nav: true, main: true }), "continue");
		assert.equal(await tab.dispatch("https://evil.test/x", { nav: true, main: true }), "abort");
		assert.equal(await tab.dispatch("https://evil.test/iframe", { nav: true, main: false }), "continue");
		assert.equal(
			await tab.dispatch("https://evil.test/iframe", { nav: true, main: true, dest: "iframe" }),
			"continue",
		);
		assert.equal(await tab.dispatch("https://evil.test/script.js", { nav: false, main: true }), "continue");
		assert.equal(tab.url(), "https://ok.test/next");
	});

	it("aborts a 302 from an approved URL onto an unapproved Registrable Domain", async () => {
		const allowed = new Set(["ok.test"]);
		const guard = createNavigationGuard(allowed);
		const tab = fakeTab("https://ok.test/start", {
			"https://ok.test/go": { status: 302, location: "https://evil.test/secret" },
		});
		await guard.ensureInstalled(tab.asPage());

		guard.begin(tab.url());
		assert.equal(await tab.dispatch("https://ok.test/go", { nav: true, main: true }), "abort");
		await assert.rejects(guard.finish(tab.asPage()), /evil\.test/);
		assert.equal(tab.url(), "https://ok.test/start");
	});

	it("restores the pre-call URL and names the blocked domain when a tool is in flight", async () => {
		const allowed = new Set(["ok.test"]);
		const guard = createNavigationGuard(allowed);
		const tab = fakeTab("https://ok.test/start");
		await guard.ensureInstalled(tab.asPage());

		guard.begin(tab.url());
		assert.equal(await tab.dispatch("https://evil.test/secret", { nav: true, main: true }), "abort");
		await assert.rejects(guard.finish(tab.asPage()), /evil\.test/);
		assert.deepEqual(tab.gotos, ["https://ok.test/start"]);
		assert.equal(tab.url(), "https://ok.test/start");
	});

	it("aborts a spontaneous hop in place and does not goto the last document", async () => {
		const allowed = new Set(["ok.test"]);
		const guard = createNavigationGuard(allowed);
		const tab = fakeTab("https://ok.test/start");
		await guard.ensureInstalled(tab.asPage());

		assert.equal(await tab.dispatch("https://evil.test/secret", { nav: true, main: true }), "abort");
		assert.deepEqual(tab.gotos, []);
		assert.equal(tab.url(), "https://ok.test/start");
	});
});

describe("shared live approved set", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-nav-gate-"));
	const allowlistPath = join(dir, "allowlist.json");
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("lets the interceptor see a grant the tool-call gate just added", async () => {
		let toolCallHandler:
			| ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>)
			| undefined;
		const pi = {
			on(_event: string, handler: typeof toolCallHandler) {
				toolCallHandler = handler;
			},
			registerTool() {},
		} as unknown as ExtensionAPI;
		const { allowed } = installDomainGate(pi, { allowlistPath });
		browserTool(pi, {
			name: "browser_navigate",
			label: "Browser Navigate",
			description: "test",
			parameters: Type.Object({ url: Type.String() }),
			async execute() {
				return { content: [], details: undefined };
			},
		});

		const url = new URL("https://shared.test/page");
		assert.equal(destinationAllowed(url, allowed), false);
		const result = await toolCallHandler!(
			{
				type: "tool_call",
				toolCallId: "call-1",
				toolName: "browser_navigate",
				input: { url: url.href },
			} as ToolCallEvent,
			{
				hasUI: true,
				ui: { select: async () => "Approve once" },
			} as unknown as ExtensionContext,
		);
		assert.equal(result, undefined);
		assert.equal(destinationAllowed(url, allowed), true);
	});
});

function fakeTab(
	startUrl: string,
	responses: Record<string, { status: number; location?: string }> = {},
) {
	let url = startUrl;
	let handler: ((route: FakeRoute) => Promise<void>) | undefined;
	const gotos: string[] = [];
	const main = {};
	const child = {};

	async function dispatch(
		next: string,
		opts: { nav: boolean; main: boolean; dest?: string },
	): Promise<"continue" | "abort"> {
		assert.ok(handler, "route handler was not installed");
		let action: "continue" | "abort" | undefined;
		const frame = opts.main ? main : child;
		const spec = responses[next] ?? { status: 200 };
		const dest = opts.dest ?? (opts.nav ? (opts.main ? "document" : "iframe") : "script");
		await handler({
			request() {
				return {
					url: () => next,
					isNavigationRequest: () => opts.nav,
					frame: () => frame,
					headers: () => ({ "sec-fetch-dest": dest }),
				};
			},
			async abort() {
				action = "abort";
			},
			async continue() {
				action = "continue";
			},
			async fetch() {
				return {
					status: () => spec.status,
					headers: () => (spec.location ? { location: spec.location } : {}),
				};
			},
			async fulfill(opts?: { status?: number }) {
				action = opts?.status === 204 ? "abort" : "continue";
			},
		});
		assert.ok(action, "route handler did not settle");
		if (action === "continue" && opts.nav && dest === "document") url = next;
		return action;
	}

	return {
		gotos,
		url: () => url,
		dispatch,
		asPage(): Page {
			return {
				mainFrame: () => main,
				url: () => url,
				async route(_pattern: string, fn: (route: FakeRoute) => Promise<void>) {
					handler = fn;
				},
				async goto(next: string) {
					gotos.push(next);
					const action = await dispatch(next, { nav: true, main: true });
					if (action !== "continue") throw new Error("net::ERR_BLOCKED_BY_CLIENT");
				},
			} as unknown as Page;
		},
	};
}

type FakeRoute = {
	request(): {
		url(): string;
		isNavigationRequest(): boolean;
		frame(): object;
	};
	abort(): Promise<void>;
	continue(): Promise<void>;
	fetch(): Promise<{ status(): number; headers(): Record<string, string> }>;
	fulfill(opts?: { status?: number }): Promise<void>;
};
