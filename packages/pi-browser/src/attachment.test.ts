import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright-core";
import {
	CDP_PORT,
	CHROME_START_COMMAND,
	createAttachment,
} from "./attachment.ts";

type FakePage = {
	gotos: string[];
	initScripts: number;
	owned: boolean;
	throwOnGoto: boolean;
	goto(url: string): Promise<null>;
	url(): string;
	title(): Promise<string>;
	addInitScript(fn: () => void): void;
	evaluate(fn: (window: unknown) => unknown): Promise<unknown>;
	close(): Promise<void>;
};

function fakePage(): FakePage {
	const page: FakePage = {
		gotos: [],
		initScripts: 0,
		owned: false,
		throwOnGoto: false,
		async goto(url) {
			if (page.throwOnGoto) throw new Error("Target closed");
			page.gotos.push(url);
			return null;
		},
		url() {
			return page.gotos.at(-1) ?? "about:blank";
		},
		async title() {
			return "Fake Title";
		},
		addInitScript() {
			page.initScripts++;
		},
		async evaluate(fn) {
			const source = fn.toString();
			if (source.includes("__piBrowserOwned = true")) {
				page.owned = true;
				return true;
			}
			if (source.includes("__piBrowserOwned === true")) return page.owned;
			return undefined;
		},
		async close() {},
	};
	return page;
}

function fakeConnector(existingPages: FakePage[] = []) {
	const endpoints: string[] = [];
	const createdPages: FakePage[] = [];
	const context = {
		pages: () => existingPages,
		newPage: async (): Promise<FakePage> => {
			const page = fakePage();
			createdPages.push(page);
			existingPages.push(page);
			return page;
		},
	};
	const browser = { contexts: () => [context] };
	const connectOverCDP = async (endpointURL: string): Promise<Browser> => {
		endpoints.push(endpointURL);
		return browser as unknown as Browser;
	};
	return {
		connectOverCDP,
		endpoints,
		createdPages,
		get ownedTab(): Page | undefined {
			return (existingPages.find((p) => p.owned) ?? undefined) as
				| Page
				| undefined;
		},
	};
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return (server.address() as AddressInfo).port;
}

function closeServer(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

describe("createAttachment", () => {
	it("exposes the default CDP port and relaunch command", () => {
		assert.equal(CDP_PORT, 9222);
		assert.equal(
			CHROME_START_COMMAND,
			"google-chrome --remote-debugging-port=9222",
		);
	});

	it("rejects with the relaunch command when nothing listens on the port", async () => {
		const probe = createServer((_req, res) => res.end());
		const port = await listen(probe);
		await closeServer(probe);

		const attachment = createAttachment({ port });
		await assert.rejects(attachment.withTab(async () => undefined), (error: Error) => {
			assert.match(error.message, /google-chrome --remote-debugging-port=9222/);
			assert.match(error.message, /remote debugging port/i);
			return true;
		});
		assert.equal(attachment.isAttached, false);
	});

	it("rejects with the relaunch command when the endpoint answers non-200", async () => {
		const server = createServer((_req, res) => {
			res.statusCode = 404;
			res.end("nope");
		});
		const port = await listen(server);
		after(() => closeServer(server));

		const attachment = createAttachment({ port });
		await assert.rejects(attachment.withTab(async () => undefined), (error: Error) => {
			assert.match(error.message, /google-chrome --remote-debugging-port=9222/);
			assert.match(String((error as { cause?: unknown }).cause), /404/);
			return true;
		});
		assert.equal(attachment.isAttached, false);
	});

	it("attaches lazily, marks a fresh Automation Tab, and reuses it", async () => {
		const server = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-id`,
				}),
			);
		});
		const port = await listen(server);
		after(() => closeServer(server));

		const connector = fakeConnector();
		const attachment = createAttachment({
			port,
			connectOverCDP: connector.connectOverCDP,
		});

		const firstTab = await attachment.withTab(async (tab) => {
			await tab.goto("https://example.test/a");
			return tab;
		});
		assert.deepEqual(connector.endpoints, [`http://127.0.0.1:${port}`]);
		assert.equal(connector.createdPages.length, 1);
		assert.equal(connector.createdPages[0].initScripts, 1);
		assert.equal(connector.createdPages[0].owned, true);
		assert.deepEqual(connector.createdPages[0].gotos, [
			"https://example.test/a",
		]);
		assert.equal(connector.ownedTab, firstTab);
		assert.equal(attachment.isAttached, true);

		const secondTab = await attachment.withTab(async (tab) => tab);
		assert.equal(secondTab, firstTab);
		assert.equal(connector.createdPages.length, 1);
		assert.deepEqual(connector.endpoints, [`http://127.0.0.1:${port}`]);
	});

	it("resets to detached on connection-closed failure and re-attaches on next call", async () => {
		const server = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1/x" }));
		});
		const port = await listen(server);
		after(() => closeServer(server));

		const connector = fakeConnector();
		const attachment = createAttachment({
			port,
			connectOverCDP: connector.connectOverCDP,
		});

		const firstTab = await attachment.withTab(async (tab) => tab);
		connector.createdPages[0].throwOnGoto = true;

		await assert.rejects(
			attachment.withTab((tab) => tab.goto("https://example.test/b")),
			/Target closed/,
		);
		assert.equal(attachment.isAttached, false);

		connector.createdPages[0].throwOnGoto = false;
		const thirdTab = await attachment.withTab(async (tab) => {
			await tab.goto("https://example.test/c");
			return tab;
		});
		assert.deepEqual(connector.endpoints, [
			`http://127.0.0.1:${port}`,
			`http://127.0.0.1:${port}`,
		]);
		assert.equal(thirdTab, firstTab);
	});
});
