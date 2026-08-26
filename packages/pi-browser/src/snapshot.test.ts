import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Page } from "playwright-core";
import { createAttachment } from "./attachment.ts";
import { refLocator, takeSnapshot } from "./snapshot.ts";

const CHROME_BIN = process.env.PI_BROWSER_CHROME_BIN ?? "google-chrome";

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

function startApp(): Promise<{ server: Server; port: number }> {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		res.setHeader("content-type", "text/html");
		res.end(url.pathname === "/dashboard" ? DASHBOARD_HTML : LOGIN_HTML);
	});
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: (server.address() as AddressInfo).port });
		});
	});
}

function closeServer(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			server.close(() => resolve(port));
		});
	});
}

async function waitForDebugEndpoint(port: number): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Chrome debug endpoint did not come up on port ${port}`);
}

function refFor(snapshotText: string, pattern: RegExp): string {
	const line = snapshotText.split("\n").find((candidate) => pattern.test(candidate));
	assert.ok(line, `no snapshot line matches ${pattern}`);
	const match = /\[ref=(e\d+)\]/.exec(line);
	assert.ok(match, `line carries no Element Ref: ${line}`);
	return match[1];
}

describe("snapshot integration", () => {
	let chrome: ChildProcess;
	let userDataDir: string;
	let appPort: number;
	let cdpPort: number;
	let attachment: ReturnType<typeof createAttachment>;
	let appServer: Server | undefined;

	before(async () => {
		const { server, port } = await startApp();
		appServer = server;
		appPort = port;

		cdpPort = await freePort();
		userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-chrome-"));
		chrome = spawn(
			CHROME_BIN,
			[
				"--headless=new",
				`--remote-debugging-port=${cdpPort}`,
				"--no-first-run",
				"--no-default-browser-check",
				`--user-data-dir=${userDataDir}`,
				"about:blank",
			],
			{ stdio: "ignore" },
		);
		await waitForDebugEndpoint(cdpPort);

		attachment = createAttachment({ port: cdpPort });
	});

	after(async () => {
		if (attachment) await attachment.close();
		chrome?.kill();
		if (appServer) await closeServer(appServer);
		rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
	});

	async function goto(path: string): Promise<Page> {
		return attachment.withTab(async (tab) => {
			await tab.goto(`http://127.0.0.1:${appPort}${path}`, { waitUntil: "load" });
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
		assert.deepEqual(
			first.text.match(/\[ref=e\d+\]/g),
			second.text.match(/\[ref=e\d+\]/g),
		);
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
		assert.equal(
			await tab.evaluate(() => document.body.dataset.signedOut),
			"true",
		);
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

	it("throws the re-snapshot error for stale or malformed refs", async () => {
		const tab = await goto("/login");
		await assert.rejects(refLocator(tab, "e9999"), /Take a new browser_snapshot/);
		await assert.rejects(refLocator(tab, "not-a-ref"), /Take a new browser_snapshot/);
	});
});
