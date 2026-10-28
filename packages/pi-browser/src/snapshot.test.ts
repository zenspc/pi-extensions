import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright-core";
import { refLocator, takeSnapshot } from "./snapshot.ts";
import { createTestBrowser, startTestApp } from "./test-support.ts";

const LOGIN_HTML = `<!doctype html>
<html><head><title>Sign in</title></head>
<body>
<main>
<form action="/dashboard" method="get">
<input id="email" name="email" placeholder="Email">
<input id="password" name="password" type="password" placeholder="Password">
<button type="submit">Sign in</button>
</form>
</main>
</body></html>`;

const DASHBOARD_HTML = `<!doctype html>
<html><head><title>Dashboard</title></head>
<body>
<nav><a href="/login">Home</a></nav>
<main>
<h1>Dashboard</h1>
<p id="status">Signed in</p>
<button id="logout">Log out</button>
</main>
<script>
document.getElementById("logout").addEventListener("click", () => {
	document.body.dataset.signedOut = "true";
	document.getElementById("status").textContent = "Signed out";
});
</script>
</body></html>`;

function refFor(snapshotText: string, pattern: RegExp): string {
	const line = snapshotText.split("\n").find((candidate) => pattern.test(candidate));
	assert.ok(line, `no snapshot line matches ${pattern}`);
	const match = /\[ref=(e\d+)\]/.exec(line);
	assert.ok(match, `line carries no Element Ref: ${line}`);
	return match[1];
}

describe("snapshot integration", () => {
	let browser: ReturnType<typeof createTestBrowser>;
	let app: Awaited<ReturnType<typeof startTestApp>>;
	before(async () => {
		browser = createTestBrowser();
		app = await startTestApp((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			res.setHeader("content-type", "text/html");
			res.end(url.pathname === "/dashboard" ? DASHBOARD_HTML : LOGIN_HTML);
		});
	});
	after(async () => {
		await browser?.close();
		await app?.close();
	});

	async function goto(path: string): Promise<Page> {
		return browser.attachment.withTab(async (tab) => {
			await tab.goto(`http://127.0.0.1:${app.port}${path}`, { waitUntil: "load" });
			return tab;
		});
	}

	it("returns identical refs across consecutive snapshots", async () => {
		const tab = await goto("/login");
		const first = await takeSnapshot(tab);
		const second = await takeSnapshot(tab);

		assert.equal(first.title, "Sign in");
		assert.ok(first.url.endsWith("/login"));
		assert.match(first.text, /\[ref=e\d+\]/);
		assert.equal(first.text, second.text);
		assert.deepEqual(first.text.match(/\[ref=e\d+\]/g), second.text.match(/\[ref=e\d+\]/g));
	});

	it("types into the referenced field", async () => {
		const tab = await goto("/login");
		const snap = await takeSnapshot(tab);
		const ref = refFor(snap.text, /textbox "Email"/);

		await (await refLocator(tab, ref)).fill("agent@example.com");
		assert.equal(await tab.locator("#email").inputValue(), "agent@example.com");
	});

	it("clicks a button and the page state changes", async () => {
		const tab = await goto("/dashboard");
		const snap = await takeSnapshot(tab);
		const ref = refFor(snap.text, /button "Log out"/);

		await (await refLocator(tab, ref)).click();
		assert.equal(await tab.evaluate(() => document.body.dataset.signedOut), "true");
	});

	it("clicks through login to reach the dashboard", async () => {
		const tab = await goto("/login");
		const loginSnap = await takeSnapshot(tab);
		const submit = refFor(loginSnap.text, /button "Sign in"/);

		await (await refLocator(tab, submit)).click();
		await tab.waitForURL(/\/dashboard/);

		const dashSnap = await takeSnapshot(tab);
		assert.match(dashSnap.url, /\/dashboard/);
		assert.match(dashSnap.text, /- link "Home"/);
		assert.match(dashSnap.text, /- button "Log out"/);
	});

	it("includes headings and readable text, not just controls", async () => {
		const tab = await goto("/dashboard");
		const snap = await takeSnapshot(tab);
		assert.match(snap.text, /heading 1 "Dashboard"/);
		assert.match(snap.text, /text "Signed in"/);
	});

	it("does not expose password values or hidden role elements", async () => {
		const tab = await goto("/login");
		await tab.setContent(
			'<input type="password" value="TOP_SECRET"><button hidden role="button">Hidden</button><div role="group"><button>Nested</button></div>'
		);
		const snap = await takeSnapshot(tab);
		assert.doesNotMatch(snap.text, /TOP_SECRET|Hidden/);
		assert.match(snap.text, /button "Nested"/);
		assert.equal(await tab.locator("[data-pi-browser-ref]").count(), 0);
	});

	it("never reuses a Ref for an element in a new document", async () => {
		const tab = await goto("/login");
		const old = refFor((await takeSnapshot(tab)).text, /textbox "Email"/);
		await goto("/login?new-document");
		const fresh = refFor((await takeSnapshot(tab)).text, /textbox "Email"/);
		assert.notEqual(old, fresh);
		await assert.rejects(refLocator(tab, old), /Take a new browser_snapshot/);
	});

	it("rejects replaced elements even when their attributes are cloned", async () => {
		const tab = await goto("/login");
		const ref = refFor((await takeSnapshot(tab)).text, /textbox "Email"/);
		await tab.locator("#email").evaluate((el) => el.replaceWith(el.cloneNode(true)));
		await assert.rejects(refLocator(tab, ref), /Take a new browser_snapshot/);
	});

	it("renders open shadow DOM and preserves checked and disabled state", async () => {
		const tab = await goto("/login");
		await tab.setContent(
			'<div id="host"></div><input type="checkbox" checked disabled aria-label="Accept">'
		);
		await tab.locator("#host").evaluate((el) => {
			el.attachShadow({ mode: "open" }).innerHTML = "<button>Shadow</button>";
		});
		const snap = await takeSnapshot(tab);
		assert.match(snap.text, /button "Shadow"/);
		assert.match(snap.text, /checkbox "Accept".*\[disabled\].*\[checked=true\]/);
	});

	it("bounds large snapshots and clearly reports truncation", async () => {
		const tab = await goto("/login");
		await tab.setContent("<button>Item</button>".repeat(1500));
		const snap = await takeSnapshot(tab);
		assert.match(snap.text, /Snapshot truncated/);
		assert.ok((snap.text.match(/\[ref=/g) ?? []).length <= 1000);
		assert.ok(snap.text.length < 51_000);
	});

	it("throws the re-snapshot error for stale or malformed refs", async () => {
		const tab = await goto("/login");
		await assert.rejects(refLocator(tab, "e9999"), /Take a new browser_snapshot/);
		await assert.rejects(refLocator(tab, "not-a-ref"), /Take a new browser_snapshot/);
	});
});
