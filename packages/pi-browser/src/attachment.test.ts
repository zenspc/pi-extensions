import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import type { Browser, Page } from "playwright-core";
import { createAttachment, type CreateAttachmentOptions } from "./attachment.ts";
import { LiveChromeWithoutDebugError } from "./occupancy.ts";

function fixture(t: TestContext, options: CreateAttachmentOptions = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-attachment-"));
	const pages: { id: string; closed: boolean; tab: Page }[] = [];
	let connected = true;
	let closes = 0;
	let launches = 0;
	let connects = 0;
	const endpoints: string[] = [];
	const cdpCalls: string[] = [];
	const context = {
		pages: () => pages.map((p) => p.tab),
		async newPage() {
			const entry = {
				id: `target-${pages.length}`,
				closed: false,
				tab: undefined as unknown as Page,
			};
			entry.tab = {
				context: () => context,
				isClosed: () => entry.closed,
				close: async () => {
					entry.closed = true;
				},
				setDefaultTimeout() {},
				setDefaultNavigationTimeout() {},
			} as unknown as Page;
			pages.push(entry);
			return entry.tab;
		},
		async newCDPSession(tab: Page) {
			return {
				async send(method: string) {
					cdpCalls.push(method);
					return { targetInfo: { targetId: pages.find((p) => p.tab === tab)!.id } };
				},
				async detach() {},
			};
		},
	};
	const browser = {
		contexts: () => [context],
		isConnected: () => connected,
		async close() {
			closes++;
			connected = false;
		},
	} as unknown as Browser;
	const attachment = createAttachment({
		userDataDir: dir,
		chromeBin: "/opt/chrome",
		inspectOccupancy: async () => ({ kind: "empty" }),
		launchChrome: () => {
			launches++;
		},
		waitForPort: async () => 45000,
		connectOverCDP: async (url) => {
			connects++;
			connected = true;
			endpoints.push(url);
			return browser;
		},
		...options,
	});
	t.after(async () => {
		await attachment.close();
		rmSync(dir, { recursive: true, force: true });
	});
	return {
		dir,
		attachment,
		pages,
		context,
		cdpCalls,
		endpoints,
		counts: () => ({ closes, launches, connects }),
		disconnect: () => {
			connected = false;
		},
	};
}

it("launches once, attaches to the discovered port, and serializes concurrent calls", async (t) => {
	const f = fixture(t);
	const order: string[] = [];
	let unblock!: () => void;
	const gate = new Promise<void>((resolve) => {
		unblock = resolve;
	});
	const first = f.attachment.withTab(async () => {
		order.push("first");
		await gate;
		order.push("done");
	});
	const second = f.attachment.withTab(async () => {
		order.push("second");
	});
	unblock();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["first", "done", "second"]);
	assert.equal(f.counts().launches, 1);
	assert.equal(f.counts().connects, 1);
	assert.deepEqual(f.endpoints, ["http://127.0.0.1:45000"]);
	assert.equal(f.pages.length, 1);
});

it("reuses only the persisted target, not a page-controlled ownership marker", async (t) => {
	const f = fixture(t, {
		inspectOccupancy: async () => ({ kind: "live-with-debug", port: 45001 }),
	});
	await f.context.newPage();
	const owned = await f.context.newPage();
	writeFileSync(
		join(f.dir, "pi-browser-target.json"),
		JSON.stringify({ targetId: f.pages[1].id })
	);
	assert.equal(await f.attachment.withTab(async (tab) => tab), owned);
	assert.equal(f.pages.length, 2);
	assert.equal(f.counts().launches, 0);
	assert.deepEqual(f.endpoints, ["http://127.0.0.1:45001"]);
});

it("creates a new tab when target metadata is missing or stale", async (t) => {
	const f = fixture(t);
	await f.context.newPage();
	writeFileSync(join(f.dir, "pi-browser-target.json"), JSON.stringify({ targetId: "gone" }));
	const tab = await f.attachment.withTab(async (tab) => tab);
	assert.notEqual(tab, f.pages[0].tab);
	assert.equal(f.pages.length, 2);
});

it("reports a live Chrome without debugging and releases its lease on failure", async (t) => {
	const f = fixture(t, { inspectOccupancy: async () => ({ kind: "live-without-debug" }) });
	await assert.rejects(
		f.attachment.withTab(async () => {}),
		LiveChromeWithoutDebugError
	);
	assert.equal(f.counts().launches, 0);
	assert.equal(f.attachment.isAttached, false);
	assert.equal(f.counts().connects, 0);
	await assert.rejects(
		f.attachment.withTab(async () => {}),
		LiveChromeWithoutDebugError
	);
});

it("clears a stale lock before launching", async (t) => {
	let cleared = false;
	const f = fixture(t, {
		inspectOccupancy: async () => ({ kind: "stale-lock" }),
		clearStaleLock: () => {
			cleared = true;
		},
		launchChrome: () => {
			assert.equal(cleared, true);
		},
	});
	await f.attachment.withTab(async () => {});
	assert.equal(cleared, true);
});

it("does not swallow operation errors or retry side effects", async (t) => {
	const f = fixture(t);
	let calls = 0;
	await assert.rejects(
		f.attachment.withTab(async () => {
			calls++;
			throw new Error("application connection error");
		}),
		/application connection error/
	);
	assert.equal(calls, 1);
	assert.equal(f.attachment.isAttached, true);
	await f.attachment.withTab(async () => {});
	assert.equal(f.counts().connects, 1);
});

it("reattaches after disconnection and replaces a closed Automation Tab", async (t) => {
	const f = fixture(t);
	const first = await f.attachment.withTab(async (tab) => tab);
	f.disconnect();
	assert.equal(f.attachment.isAttached, false);
	assert.equal(await f.attachment.withTab(async (tab) => tab), first);
	await first.close();
	assert.notEqual(await f.attachment.withTab(async (tab) => tab), first);
	assert.equal(f.counts().connects, 3);
});

it("disconnects idempotently without closing user tabs", async (t) => {
	const f = fixture(t);
	await f.attachment.withTab(async () => {});
	await Promise.all([f.attachment.close(), f.attachment.close()]);
	assert.equal(f.counts().closes, 1);
	assert.equal(f.pages[0].closed, false);
	assert.equal(f.attachment.isAttached, false);
});

it("does not attach or run a queued operation after cancellation", async (t) => {
	const f = fixture(t);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		f.attachment.withTab(async () => assert.fail("ran"), controller.signal),
		{ name: "AbortError" }
	);
	assert.equal(f.counts().launches, 0);
});

it("cancels in-flight work, interrupts JavaScript, and disconnects", async (t) => {
	const f = fixture(t);
	const controller = new AbortController();
	const work = f.attachment.withTab(async () => {
		queueMicrotask(() => controller.abort());
		return new Promise<never>(() => {});
	}, controller.signal);
	await assert.rejects(work, { name: "AbortError" });
	assert.ok(f.cdpCalls.includes("Runtime.terminateExecution"));
	assert.equal(f.attachment.isAttached, false);
});

it("times out work and leaves the queue usable", async (t) => {
	const f = fixture(t, { timeoutMs: 20 });
	const keepAlive = setInterval(() => {}, 1000);
	t.after(() => clearInterval(keepAlive));
	await assert.rejects(
		f.attachment.withTab(async () => new Promise<never>(() => {})),
		{ name: "TimeoutError" }
	);
	assert.equal(await f.attachment.withTab(async () => 42), 42);
});

it("handles an asynchronous spawn failure without an uncaught error", async (t) => {
	const f = fixture(t, {
		launchChrome: undefined,
		spawnChrome: () => {
			const child = new EventEmitter() as ChildProcess;
			child.unref = () => child;
			queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
			return child;
		},
	});
	await assert.rejects(
		f.attachment.withTab(async () => {}),
		/spawn EACCES/
	);
});
