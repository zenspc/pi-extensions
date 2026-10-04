import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright-core";
import { createAttachment } from "./attachment.ts";
import extension from "./index.ts";

const CHROME_BIN = process.env.PI_BROWSER_CHROME_BIN ?? "google-chrome";
const APPROVED_HOST = "approved.localhost";
const EVIL_HOST = "evil.localhost";
const SECRET = "UNAPPROVED_BODY";

type AnyTool = {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		...rest: unknown[]
	) => Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
};

describe("abort unapproved top-level navigation", () => {
	let chrome: ChildProcess;
	let userDataDir: string;
	let appPort: number;
	let cdpPort: number;
	let attachment: ReturnType<typeof createAttachment>;
	let appServer: Server | undefined;
	let hits: string[];
	let call: (
		name: string,
		params: Record<string, unknown>,
		select?: string,
	) => Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
	let prompts: string[];

	before(async () => {
		hits = [];
		const { server, port } = await startApp((req, res) => {
			const host = req.headers.host ?? "";
			const url = new URL(req.url ?? "/", `http://${host}`);
			hits.push(`${url.host}${url.pathname}`);
			if (url.pathname === "/go") {
				res.statusCode = 302;
				res.setHeader("location", `http://${EVIL_HOST}:${port}/secret`);
				res.end();
				return;
			}
			res.setHeader("content-type", "text/html");
			if (url.pathname === "/secret") {
				res.end(`<!doctype html><html><head><title>Secret</title></head><body>${SECRET}</body></html>`);
				return;
			}
			if (url.pathname === "/click") {
				res.end(`<!doctype html><html><head><title>Stay</title></head><body>
<a href="http://${EVIL_HOST}:${port}/secret">Leave</a>
</body></html>`);
				return;
			}
			if (url.pathname === "/framed") {
				res.end(`<!doctype html><html><head><title>Framed</title></head><body>
<p>outer</p>
<iframe src="http://${EVIL_HOST}:${port}/secret"></iframe>
</body></html>`);
				return;
			}
			if (url.pathname === "/stay") {
				res.end(`<!doctype html><html><head><title>Stay</title></head><body>
<p id="mark">here</p>
<script>window.__loads = (Number(window.__loads) || 0) + 1;</script>
</body></html>`);
				return;
			}
			res.end(`<!doctype html><html><head><title>Home</title></head><body><p>ok</p></body></html>`);
		});
		appServer = server;
		appPort = port;

		cdpPort = await freePort();
		userDataDir = mkdtempSync(join(tmpdir(), "pi-browser-abort-"));
		const allowlistPath = join(userDataDir, "allowlist.json");
		writeFileSync(
			allowlistPath,
			`${JSON.stringify({ version: 1, domains: [APPROVED_HOST] })}\n`,
		);
		chrome = spawn(
			CHROME_BIN,
			[
				"--headless=new",
				`--remote-debugging-port=${cdpPort}`,
				"--no-first-run",
				"--no-default-browser-check",
				`--user-data-dir=${userDataDir}`,
				`--host-resolver-rules=MAP ${APPROVED_HOST} 127.0.0.1,MAP ${EVIL_HOST} 127.0.0.1,MAP other.localhost 127.0.0.1`,
				"--disable-features=LocalNetworkAccessChecks",
				"about:blank",
			],
			{ stdio: "ignore" },
		);
		await waitForDebugEndpoint(cdpPort);

		attachment = createAttachment({
			userDataDir,
			launchChrome: () => {},
			waitForPort: async () => cdpPort,
		});
		const loaded = loadApp(attachment, allowlistPath);
		prompts = loaded.prompts;
		call = loaded.call;
	});

	after(async () => {
		if (attachment) await attachment.close();
		chrome?.kill();
		if (appServer) await closeServer(appServer);
		rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
	});

	async function resetTab(): Promise<void> {
		await call("browser_navigate", { url: "about:blank" });
		hits.length = 0;
		prompts.length = 0;
	}

	it("aborts a 302 from an approved URL onto an unapproved Registrable Domain", async () => {
		await resetTab();
		await assert.rejects(
			call("browser_navigate", { url: `http://${APPROVED_HOST}:${appPort}/go` }),
			/evil\.localhost/,
		);
		assert.equal(prompts.length, 0);
		const page = await attachment.withTab(async (tab) => ({
			url: tab.url(),
			body: await tab.evaluate(() => document.body?.innerText ?? ""),
		}));
		assert.doesNotMatch(page.body, new RegExp(SECRET));
		assert.equal(page.url, "about:blank");
		assert.equal(
			hits.some((hit) => hit.includes(`${EVIL_HOST}:${appPort}/secret`)),
			false,
		);
	});

	it("aborts a click onto an unapproved Registrable Domain", async () => {
		await resetTab();
		await call("browser_navigate", { url: `http://${APPROVED_HOST}:${appPort}/click` });
		const snap = await call("browser_snapshot", {});
		const ref = refFor(snap.content[0].text ?? "", /Leave/);
		await assert.rejects(call("browser_click", { ref }), /evil\.localhost/);
		assert.equal(prompts.length, 0);

		const evaluated = await call("browser_evaluate", {
			expression: "document.body.innerText",
		});
		assert.doesNotMatch(String(evaluated.content[0].text), new RegExp(SECRET));
		const after = await call("browser_snapshot", {});
		assert.doesNotMatch(after.content[0].text ?? "", new RegExp(SECRET));
		assert.match(after.content[0].text ?? "", /Stay/);
	});

	it("still prompts for an explicit browser_navigate to an unapproved site", async () => {
		await resetTab();
		const result = await call(
			"browser_navigate",
			{ url: `http://other.localhost:${appPort}/secret` },
			"Approve once",
		);
		assert.equal(prompts.length, 1);
		assert.match(prompts[0], /other\.localhost/);
		assert.match(result.content[0].text ?? "", /Secret/);
		assert.match(result.content[0].text ?? "", /other\.localhost/);
	});

	it("still loads an iframe pointed at an unapproved Registrable Domain", async () => {
		await resetTab();
		await call("browser_navigate", { url: `http://${APPROVED_HOST}:${appPort}/framed` });
		const tab = await attachment.withTab(async (page) => page);
		const frame = await waitForFrame(tab, (candidate) => candidate.url().includes("/secret"));
		assert.match(await frame.content(), new RegExp(SECRET));
		assert.ok(hits.includes(`${EVIL_HOST}:${appPort}/secret`));
	});

	it("aborts a spontaneous hop in place without restoring", async () => {
		await resetTab();
		await call("browser_navigate", { url: `http://${APPROVED_HOST}:${appPort}/stay` });
		const stayHitsBefore = hits.filter((hit) => hit.endsWith("/stay")).length;
		await attachment.withTab(async (tab) => {
			await tab
				.evaluate((href) => {
					location.href = href;
				}, `http://${EVIL_HOST}:${appPort}/secret`)
				.catch(() => undefined);
			await new Promise((resolve) => setTimeout(resolve, 300));
			assert.doesNotMatch(await tab.evaluate(() => document.body.innerText), new RegExp(SECRET));
			assert.match(tab.url(), /\/stay/);
		});
		assert.equal(
			hits.filter((hit) => hit.endsWith("/stay")).length,
			stayHitsBefore,
		);
	});
});

function loadApp(attachment: ReturnType<typeof createAttachment>, allowlistPath: string) {
	const tools = new Map<string, AnyTool>();
	let toolCallHandler:
		| ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>)
		| undefined;
	const prompts: string[] = [];
	const pi = {
		registerTool: (def: AnyTool) => tools.set(def.name, def),
		registerCommand: () => {},
		on(event: string, handler: typeof toolCallHandler) {
			if (event === "tool_call") toolCallHandler = handler;
		},
	};
	extension(pi as unknown as ExtensionAPI, {
		attachment,
		allowlistPath,
		availabilityPath: `${allowlistPath}.availability`,
	});

	async function call(
		name: string,
		params: Record<string, unknown>,
		select = "Approve once",
	) {
		assert.ok(toolCallHandler, "tool_call handler was not registered");
		const blocked = await toolCallHandler(
			{
				type: "tool_call",
				toolCallId: "test",
				toolName: name,
				input: params,
			} as ToolCallEvent,
			{
				hasUI: true,
				ui: {
					select: async (title: string) => {
						prompts.push(title);
						return select;
					},
				},
			} as unknown as ExtensionContext,
		);
		if (blocked?.block) throw new Error(blocked.reason);
		const tool = tools.get(name);
		assert.ok(tool, `${name} registered`);
		return tool.execute("test", params, undefined, undefined, undefined);
	}

	return { call, prompts };
}

function refFor(snapshotText: string, pattern: RegExp): string {
	const line = snapshotText.split("\n").find((candidate) => pattern.test(candidate));
	assert.ok(line, `no snapshot line matches ${pattern}`);
	const match = /\[ref=(e\d+)\]/.exec(line);
	assert.ok(match, `line carries no Element Ref: ${line}`);
	return match[1];
}

function startApp(
	handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
	const server = createServer(handler);
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

async function waitForFrame(
	tab: Page,
	match: (frame: { url(): string; content(): Promise<string> }) => boolean,
) {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const frame = tab.frames().find(match);
		if (frame) return frame;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("iframe did not load");
}
