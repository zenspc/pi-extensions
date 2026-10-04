import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { createAttachment } from "./attachment.ts";
import { chromeLaunchArgs } from "./launch.ts";
import { LiveChromeWithoutDebugError } from "./occupancy.ts";
import { resolveChromeBinary, resolveUserDataDir } from "./resolve.ts";

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
	let closed = 0;
	const context = {
		pages: () => existingPages,
		newPage: async (): Promise<FakePage> => {
			const page = fakePage();
			createdPages.push(page);
			existingPages.push(page);
			return page;
		},
	};
	const browser = {
		contexts: () => [context],
		async close() {
			closed++;
		},
	};
	const connectOverCDP = async (endpointURL: string): Promise<Browser> => {
		endpoints.push(endpointURL);
		return browser as unknown as Browser;
	};
	return {
		connectOverCDP,
		endpoints,
		createdPages,
		get closed() {
			return closed;
		},
		get ownedTab(): Page | undefined {
			return (existingPages.find((p) => p.owned) ?? undefined) as Page | undefined;
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

function jsonVersionServer(): Server {
	return createServer((_req, res) => {
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1/x" }));
	});
}

describe("createAttachment", () => {
	it("launches against the User Data Dir and attaches to the discovered Debug Port", async () => {
		const server = jsonVersionServer();
		const port = await listen(server);
		after(() => closeServer(server));

		const launches: { chromeBin: string; userDataDir: string }[] = [];
		const connector = fakeConnector();
		const attachment = createAttachment({
			userDataDir: "/tmp/pi-chrome-test",
			chromeBin: "/opt/chrome",
			launchChrome: (spec) => {
				launches.push(spec);
			},
			waitForPort: async () => port,
			connectOverCDP: connector.connectOverCDP,
		});

		const firstTab = await attachment.withTab(async (tab) => {
			await tab.goto("https://example.test/a");
			return tab;
		});
		assert.equal(launches.length, 1);
		assert.equal(launches[0].chromeBin, "/opt/chrome");
		assert.equal(launches[0].userDataDir, "/tmp/pi-chrome-test");
		assert.deepEqual(connector.endpoints, [`http://127.0.0.1:${port}`]);
		assert.notEqual(port, 9222);
		assert.equal(connector.createdPages.length, 1);
		assert.equal(connector.createdPages[0].initScripts, 1);
		assert.equal(connector.createdPages[0].owned, true);
		assert.deepEqual(connector.createdPages[0].gotos, ["https://example.test/a"]);
		assert.equal(connector.ownedTab, firstTab);
		assert.equal(attachment.isAttached, true);

		const secondTab = await attachment.withTab(async (tab) => tab);
		assert.equal(secondTab, firstTab);
		assert.equal(connector.createdPages.length, 1);
		assert.equal(launches.length, 1);
		assert.deepEqual(connector.endpoints, [`http://127.0.0.1:${port}`]);
	});

	it("does not attach to a Chrome listening on 9222 that is not this User Data Dir", async () => {
		const decoyHits: string[] = [];
		const decoy = createServer((req, res) => {
			decoyHits.push(req.url ?? "");
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/decoy" }));
		});
		const decoyBound = await new Promise<boolean>((resolve) => {
			decoy.on("error", () => resolve(false));
			decoy.listen(9222, "127.0.0.1", () => resolve(true));
		});
		if (decoyBound) after(() => closeServer(decoy));
		else decoy.close();

		const ours = jsonVersionServer();
		const port = await listen(ours);
		after(() => closeServer(ours));

		const connector = fakeConnector();
		const attachment = createAttachment({
			userDataDir: "/tmp/owned-dir",
			chromeBin: "/opt/chrome",
			launchChrome: () => {},
			waitForPort: async () => port,
			connectOverCDP: connector.connectOverCDP,
		});

		await attachment.withTab(async () => undefined);
		assert.deepEqual(connector.endpoints, [`http://127.0.0.1:${port}`]);
		assert.notEqual(port, 9222);
		if (decoyBound) {
			assert.equal(
				decoyHits.some((url) => url.includes("/json/version")),
				false,
			);
		}
	});

	it("errors without a 9222 start command when the Debug Port never appears", async () => {
		const attachment = createAttachment({
			userDataDir: "/tmp/dead-dir",
			chromeBin: "/opt/chrome",
			launchChrome: () => {},
			waitForPort: async () => {
				throw new Error("No Debug Port found in the User Data Dir at /tmp/dead-dir.");
			},
		});
		await assert.rejects(attachment.withTab(async () => undefined), (error: Error) => {
			assert.match(error.message, /User Data Dir/);
			assert.doesNotMatch(error.message, /9222/);
			assert.doesNotMatch(error.message, /remote-debugging-port/);
			return true;
		});
		assert.equal(attachment.isAttached, false);
	});

	it("resets to detached on connection-closed failure and re-attaches on next call", async () => {
		const server = jsonVersionServer();
		const port = await listen(server);
		after(() => closeServer(server));

		const launches: number[] = [];
		const connector = fakeConnector();
		const attachment = createAttachment({
			userDataDir: "/tmp/reconnect",
			chromeBin: "/opt/chrome",
			launchChrome: () => {
				launches.push(1);
			},
			waitForPort: async () => port,
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
		assert.equal(launches.length, 2);
		assert.equal(thirdTab, firstTab);
	});

	it("disconnects Playwright on close and does not need a Chrome child to kill", async () => {
		const server = jsonVersionServer();
		const port = await listen(server);
		after(() => closeServer(server));

		const connector = fakeConnector();
		const attachment = createAttachment({
			userDataDir: "/tmp/stay-up",
			chromeBin: "/opt/chrome",
			launchChrome: () => {},
			waitForPort: async () => port,
			connectOverCDP: connector.connectOverCDP,
		});
		await attachment.withTab(async () => undefined);
		await attachment.close();
		assert.equal(attachment.isAttached, false);
		assert.equal(connector.closed, 1);
	});

	it("resolves User Data Dir and Chrome binary when they are not injected", async () => {
		const server = jsonVersionServer();
		const port = await listen(server);
		after(() => closeServer(server));

		const launches: { chromeBin: string; userDataDir: string }[] = [];
		const attachment = createAttachment({
			launchChrome: (spec) => {
				launches.push(spec);
			},
			waitForPort: async () => port,
			connectOverCDP: fakeConnector().connectOverCDP,
		});

		await attachment.withTab(async () => undefined);
		assert.equal(launches.length, 1);
		assert.equal(launches[0].userDataDir, resolveUserDataDir());
		assert.equal(launches[0].chromeBin, resolveChromeBinary());
	});

	it("attaches to a live dedicated Chrome and does not launch or clear the lock", async () => {
		const existing = fakePage();
		existing.owned = true;
		const connector = fakeConnector([existing]);
		const launches: unknown[] = [];
		const clears: string[] = [];
		const attachment = createAttachment({
			userDataDir: "/tmp/already-live",
			chromeBin: "/opt/chrome",
			inspectOccupancy: async () => ({ kind: "live-with-debug", port: 45000 }),
			clearStaleLock: (dir) => {
				clears.push(dir);
			},
			launchChrome: (spec) => {
				launches.push(spec);
			},
			waitForPort: async () => {
				throw new Error("should not wait for a new Debug Port");
			},
			connectOverCDP: connector.connectOverCDP,
		});

		const tab = await attachment.withTab(async (page) => page);
		assert.equal(tab, existing);
		assert.equal(connector.createdPages.length, 0);
		assert.deepEqual(connector.endpoints, ["http://127.0.0.1:45000"]);
		assert.equal(launches.length, 0);
		assert.deepEqual(clears, []);
	});

	it("fails when live Chrome has no Debug Port and does not delete the lock", async () => {
		const launches: unknown[] = [];
		const clears: string[] = [];
		const attachment = createAttachment({
			userDataDir: "/tmp/live-no-debug",
			chromeBin: "/opt/chrome",
			inspectOccupancy: async () => ({ kind: "live-without-debug" }),
			clearStaleLock: (dir) => {
				clears.push(dir);
			},
			launchChrome: (spec) => {
				launches.push(spec);
			},
			connectOverCDP: async () => {
				throw new Error("should not connect");
			},
		});

		await assert.rejects(
			attachment.withTab(async () => undefined),
			(error: unknown) =>
				error instanceof LiveChromeWithoutDebugError &&
				error.message.includes("/tmp/live-no-debug") &&
				/quit that window/i.test(error.message) &&
				!/9222/.test(error.message),
		);
		assert.equal(attachment.isAttached, false);
		assert.equal(launches.length, 0);
		assert.deepEqual(clears, []);
	});

	it("deletes a stale lock then launches", async () => {
		const connector = fakeConnector();
		const launches: { userDataDir: string }[] = [];
		const clears: string[] = [];
		const attachment = createAttachment({
			userDataDir: "/tmp/stale-lock",
			chromeBin: "/opt/chrome",
			inspectOccupancy: async () => ({ kind: "stale-lock" }),
			clearStaleLock: (dir) => {
				clears.push(dir);
			},
			launchChrome: (spec) => {
				launches.push(spec);
			},
			waitForPort: async () => 45001,
			connectOverCDP: connector.connectOverCDP,
		});

		await attachment.withTab(async () => undefined);
		assert.deepEqual(clears, ["/tmp/stale-lock"]);
		assert.equal(launches.length, 1);
		assert.equal(launches[0].userDataDir, "/tmp/stale-lock");
		assert.deepEqual(connector.endpoints, ["http://127.0.0.1:45001"]);
		assert.equal(connector.createdPages.length, 1);
	});

	it("default launch wrapper spawns headed Chrome detached on the User Data Dir", async () => {
		const server = jsonVersionServer();
		const port = await listen(server);
		after(() => closeServer(server));

		const calls: { bin: string; args: string[]; options: SpawnOptions }[] = [];
		let unrefed = false;
		const child = new EventEmitter() as ChildProcess;
		child.unref = () => {
			unrefed = true;
			return child;
		};

		const attachment = createAttachment({
			userDataDir: "/tmp/default-launch",
			chromeBin: "/opt/chrome",
			spawnChrome: (bin, args, options) => {
				calls.push({ bin, args, options });
				return child;
			},
			waitForPort: async () => port,
			connectOverCDP: fakeConnector().connectOverCDP,
		});

		await attachment.withTab(async () => undefined);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].bin, "/opt/chrome");
		assert.deepEqual(calls[0].args, chromeLaunchArgs("/tmp/default-launch"));
		assert.equal(calls[0].options.detached, true);
		assert.equal(calls[0].options.stdio, "ignore");
		assert.equal(unrefed, true);
	});
});
