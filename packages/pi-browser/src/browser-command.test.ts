import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

type AnyTool = ToolDefinition<any, any>;

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-browser-command-"));
}

function loadExtension(
	availabilityPath: string,
	allowlistPath: string,
	options?: { throwUntilBound?: boolean },
) {
	const tools = new Map<string, AnyTool>();
	let active: string[] = ["read", "bash"];
	let bound = false;
	const statuses: unknown[] = [];
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	let sessionStart: (() => Promise<void>) | undefined;
	const uninitialized = () => {
		throw new Error(
			"Extension runtime not initialized. Action methods cannot be called during extension loading.",
		);
	};
	const pi = {
		registerTool(def: AnyTool) {
			tools.set(def.name, def);
			if (!active.includes(def.name)) active.push(def.name);
		},
		registerCommand(_name: string, def: { handler: typeof handler }) {
			handler = def.handler;
		},
		getActiveTools: () => {
			if (options?.throwUntilBound && !bound) uninitialized();
			return [...active];
		},
		setActiveTools(names: string[]) {
			if (options?.throwUntilBound && !bound) uninitialized();
			active = [...names];
		},
		on(event: string, fn: () => Promise<void>) {
			if (event === "session_start") sessionStart = fn;
		},
	};
	extension(pi as unknown as ExtensionAPI, { availabilityPath, allowlistPath });
	assert.ok(handler, "/browser was not registered");
	return {
		tools,
		active: () => active,
		statuses,
		async start() {
			bound = true;
			await sessionStart?.();
		},
		async run(args: string) {
			const notifications: { message: string; level?: string }[] = [];
			const ctx = {
				hasUI: true,
				ui: {
					notify: (message: string, level?: string) => {
						notifications.push({ message, level });
					},
					setStatus: (...args: unknown[]) => {
						statuses.push(args);
					},
				},
			} as unknown as ExtensionCommandContext;
			await handler!(args, ctx);
			return notifications;
		},
	};
}

describe("/browser command", () => {
	const dir = tempDir();
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("hides Browser Tools on off and restore them on on", async () => {
		const availabilityPath = join(dir, "ok.json");
		const allowlistPath = join(dir, "allow.json");
		const allowlist = JSON.stringify({ version: 1, domains: ["example.com"] });
		writeFileSync(allowlistPath, allowlist);
		const app = loadExtension(availabilityPath, allowlistPath);
		const browserTools = [...app.tools.keys()];
		assert.ok(browserTools.length > 0);
		assert.ok(browserTools.every((name) => app.active().includes(name)));

		const off = await app.run("off");
		assert.match(off[0]?.message ?? "", /\boff\b/);
		assert.notEqual(off[0]?.level, "error");
		for (const name of browserTools) {
			assert.equal(app.active().includes(name), false, name);
		}
		assert.deepEqual(
			app.active().filter((name) => name === "read" || name === "bash"),
			["read", "bash"],
		);
		assert.deepEqual(app.statuses, []);

		const on = await app.run("on");
		assert.match(on[0]?.message ?? "", /\bon\b/);
		for (const name of browserTools) {
			assert.equal(app.active().includes(name), true, name);
		}
		assert.equal(readFileSync(allowlistPath, "utf8"), allowlist);
	});

	it("keeps live Tool Availability when save fails", async () => {
		const availabilityPath = join(dir, "cannot-write");
		mkdirSync(availabilityPath);
		const app = loadExtension(availabilityPath, join(dir, "allow-fail.json"));
		const before = app.active();
		const notes = await app.run("disable");
		assert.equal(notes[0]?.level, "error");
		assert.deepEqual(app.active(), before);
	});

	it("reports status without changing Tool Availability", async () => {
		const availabilityPath = join(dir, "status.json");
		const app = loadExtension(availabilityPath, join(dir, "allow-status.json"));
		const before = [...app.active()];
		const notes = await app.run("");
		assert.match(notes[0]?.message ?? "", /\bon\b/);
		assert.deepEqual(app.active(), before);
		const help = await app.run("help");
		assert.match(help[0]?.message ?? "", /Usage:/);
		assert.notEqual(help[0]?.level, "warning");
		const unknown = await app.run("nope");
		assert.equal(unknown[0]?.level, "warning");
		assert.match(unknown[0]?.message ?? "", /Usage:/);
		assert.deepEqual(app.active(), before);
	});

	it("hides Browser Tools for a new session after off", async () => {
		const availabilityPath = join(dir, "sticky.json");
		const allowlistPath = join(dir, "allow-sticky.json");
		const first = loadExtension(availabilityPath, allowlistPath);
		await first.run("off");
		const second = loadExtension(availabilityPath, allowlistPath, { throwUntilBound: true });
		await second.start();
		for (const name of second.tools.keys()) {
			assert.equal(second.active().includes(name), false, name);
		}
		assert.ok(second.active().includes("read"));
	});

	it("does not call getActiveTools during extension load", () => {
		const availabilityPath = join(dir, "off-at-load.json");
		writeFileSync(availabilityPath, JSON.stringify({ available: false }));
		const app = loadExtension(availabilityPath, join(dir, "allow-load.json"), {
			throwUntilBound: true,
		});
		assert.ok([...app.tools.keys()].length > 0);
	});
});
