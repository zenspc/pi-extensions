import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright-core";
import { createAttachment } from "./attachment.ts";
import extension from "./index.ts";

const CHROME_BIN = process.env.PI_BROWSER_CHROME_BIN ?? "google-chrome";

const PAGE_HTML = `<!doctype html>
<html><head><title>Eval page</title></head>
<body>
<main><p id="label">Ready</p></main>
</body></html>`;

type AnyTool = ToolDefinition<any, any>;

function loadTools(attachment: ReturnType<typeof createAttachment>): Map<string, AnyTool> {
	const tools = new Map<string, AnyTool>();
	const pi = {
		registerTool: (def: AnyTool) => tools.set(def.name, def),
		on: () => {},
	};
	extension(pi as unknown as ExtensionAPI, { attachment });
	return tools;
}

function startApp(): Promise<{ server: Server; port: number }> {
	const server = createServer((_req, res) => {
		res.setHeader("content-type", "text/html");
		res.end(PAGE_HTML);
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
	const deadline = Date.now() + 10_000;
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

describe("screenshot and evaluate integration", () => {
	let chrome: ChildProcess;
	let userDataDir: string;
	let appPort: number;
	let cdpPort: number;
	let attachment: ReturnType<typeof createAttachment>;
	let appServer: Server | undefined;
	let tools: Map<string, AnyTool>;

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
		tools = loadTools(attachment);
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

	it("registers the screenshot and evaluate tools with URL gating", () => {
		assert.ok(tools.get("browser_screenshot"), "browser_screenshot registered");
		assert.ok(tools.get("browser_evaluate"), "browser_evaluate registered");
	});

	it("captures a valid PNG with plausible dimensions", async () => {
		await goto("/");
		const result = await tools.get("browser_screenshot")!.execute("test", {});

		const note = result.content.find(
			(item: { type: string }) => item.type === "text",
		);
		assert.match(note.text, /Screenshot captured \(\d+x\d+ px\)/);

		const image = result.content.find((item: { type: string }) => item.type === "image");
		assert.equal(image.mimeType, "image/png");
		const png = Buffer.from(image.data, "base64");
		assert.equal(
			png.subarray(0, 8).toString("hex"),
			"89504e470d0a1a0a",
			"PNG signature",
		);
		assert.ok(result.details.width > 0);
		assert.ok(result.details.height > 0);
		assert.equal(png.readUInt32BE(16), result.details.width);
		assert.equal(png.readUInt32BE(20), result.details.height);
	});

	it("serializes a number from the page context", async () => {
		await goto("/");
		const result = await tools
			.get("browser_evaluate")!
			.execute("test", { expression: "6 * 7" });
		assert.equal(result.content[0].text, "42");
		assert.equal(result.details.result, 42);
	});

	it("serializes an object from the page context", async () => {
		await goto("/");
		const result = await tools.get("browser_evaluate")!.execute("test", {
			expression: `(() => ({ label: document.getElementById("label").textContent, n: 3 }))()`,
		});
		assert.deepEqual(result.details.result, { label: "Ready", n: 3 });
		assert.equal(result.content[0].text, JSON.stringify({ label: "Ready", n: 3 }, null, 2));
	});

	it("serializes a string from the page context", async () => {
		await goto("/");
		const result = await tools
			.get("browser_evaluate")!
			.execute("test", { expression: `"hello".toUpperCase()` });
		assert.equal(result.content[0].text, '"HELLO"');
		assert.equal(result.details.result, "HELLO");
	});

	it("rejects with the page error text on thrown errors", async () => {
		await goto("/");
		await assert.rejects(
			tools
				.get("browser_evaluate")!
				.execute("test", { expression: `(() => { throw new Error("boom") })()` }),
			/boom/,
		);
	});

	it("rejects on a syntax error in the expression", async () => {
		await goto("/");
		await assert.rejects(
			tools.get("browser_evaluate")!.execute("test", { expression: "(() => {" }),
			/browser_evaluate failed.*(Syntax|syntax)/i,
		);
	});
});
