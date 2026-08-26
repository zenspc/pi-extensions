import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createAttachment } from "./attachment.ts";
import extension from "./index.ts";
import { launchDedicatedChrome, waitForDebugPort } from "./launch.ts";
import { resolveChromeBinary } from "./resolve.ts";

const PAGE_HTML = `<!doctype html>
<html><head><title>Launch page</title></head>
<body><main><p>launched</p></main></body></html>`;

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

async function probe(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		return response.ok;
	} catch {
		return false;
	}
}

function killChrome(chrome: ChildProcess | undefined): void {
	if (!chrome?.pid) return;
	try {
		process.kill(-chrome.pid, "SIGTERM");
	} catch {
		try {
			chrome.kill("SIGTERM");
		} catch {
			return;
		}
	}
}

describe("launch path", () => {
	it("launches Chrome on a throwaway User Data Dir and browser_navigate loads a URL", async () => {
		const { server, port: appPort } = await startApp();
		after(() => closeServer(server));

		const userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-launch-"));
		after(() => rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }));

		const chromeBin = resolveChromeBinary();
		let chrome: ChildProcess | undefined;
		after(() => killChrome(chrome));

		const decoyHits: string[] = [];
		const decoy = createServer((req, res) => {
			decoyHits.push(req.url ?? "");
			res.statusCode = 200;
			res.end("{}");
		});
		const decoyBound = await new Promise<boolean>((resolve) => {
			decoy.on("error", () => resolve(false));
			decoy.listen(9222, "127.0.0.1", () => resolve(true));
		});
		if (decoyBound) after(() => closeServer(decoy));
		else decoy.close();

		const attachment = createAttachment({
			userDataDir,
			chromeBin,
			extraArgs: ["--headless=new"],
			launchChrome: (spec) => {
				chrome = launchDedicatedChrome(spec, spawn);
			},
		});

		const tools = loadTools(attachment);
		const navigate = tools.get("browser_navigate");
		assert.ok(navigate, "browser_navigate registered");

		const result = await navigate.execute(
			"test",
			{ url: `http://127.0.0.1:${appPort}/` },
			undefined,
			undefined,
			undefined as never,
		);
		assert.match(result.content[0].text, /Launch page/);
		assert.match(result.content[0].text, new RegExp(`127\\.0\\.0\\.1:${appPort}`));
		assert.equal(result.details.title, "Launch page");

		const debugPort = await waitForDebugPort(userDataDir, { timeoutMs: 5_000 });
		assert.notEqual(debugPort, 9222);
		if (decoyBound) {
			assert.equal(
				decoyHits.some((url) => url.includes("/json/version")),
				false,
			);
		}

		await attachment.close();
		assert.equal(attachment.isAttached, false);
		assert.equal(await probe(debugPort), true, "Chrome stays up after Attachment.close");
	});
});
