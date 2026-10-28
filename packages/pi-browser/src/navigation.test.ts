import assert from "node:assert/strict";
import { it } from "node:test";
import type { Page } from "playwright-core";

type PausedNavigation = { requestId: string; frameId: string; request: { url: string } };
import { createNavigationGuard, destinationAllowed } from "./navigation.ts";

it("allows only approved HTTP(S) domains and about:blank", () => {
	const allowed = new Set(["example.com", "127.0.0.1"]);
	for (const url of [
		"about:blank",
		"about:blank#keep",
		"https://sub.example.com/x",
		"http://example.com:8080",
		"http://127.0.0.1:9",
	]) {
		assert.equal(destinationAllowed(new URL(url), allowed), true, url);
	}
	for (const url of [
		"https://evil.test",
		"https://github.io",
		"about:srcdoc",
		"file:///tmp/x",
		"data:text/html,x",
	]) {
		assert.equal(destinationAllowed(new URL(url), allowed), false, url);
	}
});

function fakeTab(initial = "https://ok.test/start") {
	let url = initial;
	let listener: ((event: PausedNavigation) => void) | undefined;
	const calls: { method: string; params: any }[] = [];
	const gotos: string[] = [];
	const cdp = {
		on: (_name: string, fn: typeof listener) => {
			listener = fn;
		},
		async send(method: string, params: unknown) {
			calls.push({ method, params });
			return { frameTree: { frame: { id: "main" } } };
		},
		async detach() {},
	};
	const tab = {
		context: () => ({ newCDPSession: async () => cdp }),
		once() {},
		url: () => url,
		async goto(next: string) {
			gotos.push(next);
			url = next;
		},
	} as unknown as Page;
	return {
		tab,
		calls,
		gotos,
		setUrl: (next: string) => {
			url = next;
		},
		async dispatch(next: string, frameId = "main") {
			assert.ok(listener);
			listener({ requestId: "r1", frameId, request: { url: next } } as PausedNavigation);
			await Promise.resolve();
			return calls.at(-1)!.method;
		},
	};
}

it("installs one Document-only interceptor and bypasses service workers only in this tab", async () => {
	const f = fakeTab();
	const guard = createNavigationGuard(new Set(["ok.test"]));
	await Promise.all([guard.ensureInstalled(f.tab), guard.ensureInstalled(f.tab)]);
	assert.equal(f.calls.filter((c) => c.method === "Fetch.enable").length, 1);
	assert.deepEqual(f.calls.find((c) => c.method === "Fetch.enable")!.params, {
		patterns: [{ resourceType: "Document", requestStage: "Request" }],
	});
	assert.deepEqual(f.calls.find((c) => c.method === "Network.setBypassServiceWorker")!.params, {
		bypass: true,
	});
});

it("blocks unapproved main-frame requests but continues approved domains and iframes", async () => {
	const f = fakeTab();
	const guard = createNavigationGuard(new Set(["ok.test"]));
	await guard.ensureInstalled(f.tab);
	assert.equal(await f.dispatch("https://ok.test/next"), "Fetch.continueRequest");
	assert.equal(await f.dispatch("https://evil.test/secret"), "Fetch.fulfillRequest");
	assert.equal(f.calls.at(-1)!.params.responseCode, 204);
	assert.equal(await f.dispatch("https://evil.test/frame", "child"), "Fetch.continueRequest");
});

it("reports a blocked hop without reloading the unchanged document", async () => {
	const f = fakeTab();
	const guard = createNavigationGuard(new Set(["ok.test"]));
	await guard.ensureInstalled(f.tab);
	guard.begin(f.tab.url());
	await f.dispatch("https://evil.test/secret");
	await assert.rejects(guard.finish(f.tab), /evil.test/);
	assert.deepEqual(f.gotos, []);
});

it("restores a changed URL, but never restores an unapproved document", async () => {
	const f = fakeTab();
	const guard = createNavigationGuard(new Set(["ok.test"]));
	await guard.ensureInstalled(f.tab);
	guard.begin(f.tab.url());
	f.setUrl("https://ok.test/intermediate");
	await f.dispatch("https://evil.test/secret");
	await assert.rejects(guard.finish(f.tab), /evil.test/);
	assert.deepEqual(f.gotos, ["https://ok.test/start"]);
	guard.begin("https://unapproved.test/");
	f.setUrl("https://ok.test/intermediate");
	await f.dispatch("https://evil.test/secret");
	await assert.rejects(guard.finish(f.tab), /evil.test/);
	assert.equal(f.gotos.at(-1), "about:blank");
});

it("blocks spontaneous hops in place and sees later approvals through the live set", async () => {
	const allowed = new Set(["ok.test"]);
	const f = fakeTab();
	const guard = createNavigationGuard(allowed);
	await guard.ensureInstalled(f.tab);
	assert.equal(await f.dispatch("https://evil.test/secret"), "Fetch.fulfillRequest");
	assert.deepEqual(f.gotos, []);
	allowed.add("evil.test");
	assert.equal(await f.dispatch("https://evil.test/secret"), "Fetch.continueRequest");
});

it("fails closed if the final URL changed outside the network interceptor", async () => {
	const f = fakeTab();
	const guard = createNavigationGuard(new Set(["ok.test"]));
	guard.begin(f.tab.url());
	f.setUrl("file:///tmp/secret");
	await assert.rejects(guard.finish(f.tab), /file:/);
	assert.equal(f.tab.url(), "https://ok.test/start");
});
