import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import footerExtension from "../../extensions/custom-footer.ts";

async function app(t: TestContext, dir?: string, mode = "tui") {
	dir ??= mkdtempSync(join(tmpdir(), "pi-footer-test-"));
	const configPath = join(dir, "footer.json");
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const notifications: { message: string; type: string }[] = [];
	const choices: (string | undefined)[] = [];
	let component: any;
	let branchSubscriptions = 0;
	let renders = 0;
	let thinking = "high";
	let context: any = { tokens: 1000, contextWindow: 10000, percent: 10 };
	let options: string[] = [];
	const session = SessionManager.inMemory();
	const ctx = {
		mode,
		isIdle: () => true,
		sessionManager: session,
		model: {
			provider: "test",
			id: "model",
			reasoning: true,
			contextWindow: 20000,
			cost: { input: 1, output: 1 },
		},
		getContextUsage: () => context,
		ui: {
			notify(message: string, type: string) {
				notifications.push({ message, type });
			},
			async select(_title: string, items: string[]) {
				options = items;
				return choices.shift();
			},
			setFooter(factory: Function) {
				component?.dispose();
				component = factory(
					{
						requestRender() {
							renders++;
						},
					},
					{ fg: (_color: string, text: string) => text },
					{
						onBranchChange() {
							branchSubscriptions++;
							return () => {
								branchSubscriptions--;
							};
						},
						getGitBranch: () => "main",
					}
				);
			},
		},
	};
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		footerExtension({
			on(name: string, fn: Function) {
				handlers.set(name, [...(handlers.get(name) ?? []), fn]);
				return () =>
					handlers.set(
						name,
						(handlers.get(name) ?? []).filter(
							(handler) => handler !== fn
						)
					);
			},
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
			getThinkingLevel: () => thinking,
		} as any);
	} finally {
		if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousDir;
	}
	const emit = async (name: string, event = {}) => {
		for (const handler of [...(handlers.get(name) ?? [])])
			await handler(event, ctx);
	};
	t.after(async () => {
		await emit("session_shutdown");
		rmSync(dir!, { recursive: true, force: true });
	});
	await emit("session_start");
	return {
		dir,
		configPath,
		session,
		notifications,
		choices,
		emit,
		command: (args = "") => commands.get("footer").handler(args, ctx),
		completions: (prefix: string) =>
			commands.get("footer").getArgumentCompletions(prefix),
		render: (width = 200) => component?.render(width).join("\n"),
		handlerCount: (name: string) => handlers.get(name)?.length ?? 0,
		get branchSubscriptions() {
			return branchSubscriptions;
		},
		get renders() {
			return renders;
		},
		get options() {
			return options;
		},
		set thinking(value: string) {
			thinking = value;
		},
		set context(value: any) {
			context = value;
		},
	};
}

describe("footer picker", () => {
	it("offers both layouts, switches immediately, and restores the global choice in another session", async (t) => {
		const first = await app(t);
		assert.match(first.render(), /↑0.*↓0/);
		first.choices.push("context-bar");
		await first.command();
		assert.deepEqual(first.options, ["custom-footer", "context-bar"]);
		assert.match(
			first.render(),
			/test\/model · high.*Context: \[██░+\] 1\.0k\/10\.0k.*10%/
		);
		assert.deepEqual(JSON.parse(readFileSync(first.configPath, "utf8")), {
			style: "context-bar",
		});
		const second = await app(t, first.dir);
		assert.match(second.render(), /Context:/);
		await second.command("custom-footer");
		assert.match(second.render(), /↑0.*↓0/);
		assert.deepEqual(second.completions("con"), [
			{ value: "context-bar", label: "context-bar" },
		]);
	});

	it("leaves the footer and preference alone on cancellation or invalid input", async (t) => {
		const instance = await app(t);
		await instance.command();
		await instance.command("__proto__");
		await instance.command("custom-footer unexpected");
		assert.match(instance.render(), /↑0/);
		assert.deepEqual(readdirSync(instance.dir), []);
		assert.equal(
			instance.notifications.filter((n) => n.type === "error").length,
			2
		);
	});

	it("falls back with a warning for malformed or unknown saved styles", async (t) => {
		const instance = await app(t);
		for (const data of ["{bad", '{"style":"unknown"}', "null"]) {
			writeFileSync(instance.configPath, data);
			await instance.emit("session_start");
			assert.match(instance.render(), /↑0/);
		}
		assert.equal(
			instance.notifications.filter((n) => n.type === "warning").length,
			3
		);
		assert.equal(instance.branchSubscriptions, 1);
	});

	it("keeps the active layout and cleans up temporary files if saving fails", async (t) => {
		const instance = await app(t);
		mkdirSync(instance.configPath);
		await instance.command("context-bar");
		assert.match(instance.render(), /↑0/);
		assert.equal(instance.notifications.at(-1)?.type, "error");
		assert.deepEqual(readdirSync(instance.dir), ["footer.json"]);
	});

	it("does not mount or save in non-TUI modes", async (t) => {
		for (const mode of ["rpc", "json", "print"]) {
			const instance = await app(t, undefined, mode);
			await instance.command("context-bar");
			assert.equal(instance.render(), undefined);
			assert.deepEqual(readdirSync(instance.dir), []);
			assert.match(
				instance.notifications.at(-1)!.message,
				/requires interactive mode/
			);
		}
	});

	it("removes old event handlers, branch subscriptions, and timers on switches and shutdown", async (t) => {
		t.mock.timers.enable({ apis: ["setInterval"] });
		const instance = await app(t);
		for (let i = 0; i < 3; i++) {
			await instance.emit("message_end", {
				message: { role: "assistant", usage: { output: 1 } },
			});
			await instance.command("context-bar");
			assert.equal(instance.handlerCount("message_end"), 1);
			assert.equal(instance.handlerCount("thinking_level_select"), 1);
			assert.equal(instance.branchSubscriptions, 1);
			const before = instance.renders;
			t.mock.timers.tick(2000);
			assert.equal(instance.renders, before);
			instance.thinking = "low";
			await instance.emit("thinking_level_select");
			assert.match(instance.render(), /· low/);
			await instance.command("custom-footer");
			assert.equal(instance.handlerCount("message_end"), 1);
			assert.equal(instance.handlerCount("thinking_level_select"), 1);
		}
		await instance.emit("session_shutdown");
		assert.equal(instance.branchSubscriptions, 0);
		assert.equal(instance.handlerCount("message_end"), 0);
		const before = instance.renders;
		t.mock.timers.tick(2000);
		assert.equal(instance.renders, before);
	});

	it("keeps the same cache timer when switching layouts and stops it on shutdown", async (t) => {
		t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
		const instance = await app(t);
		instance.session.appendMessage({
			role: "assistant",
			content: [],
			timestamp: Date.now(),
		} as any);
		await instance.emit("message_end", {
			message: { role: "assistant", usage: { output: 1 } },
		});
		t.mock.timers.tick(30_000);
		assert.match(instance.render(), /30s/);
		await instance.command("context-bar");
		assert.match(instance.render(), /Context:.*30s$/);
		const before = instance.renders;
		t.mock.timers.tick(1000);
		assert.equal(instance.renders, before + 1);
		assert.match(instance.render(), /31s$/);
		for (const width of [1, 20, 60, 100, 200])
			assert.ok(visibleWidth(instance.render(width)) <= width);
		await instance.emit("agent_start");
		assert.match(instance.render(), /live$/);
		await instance.emit("agent_end");
		assert.match(instance.render(), /31s$/);
		await instance.emit("session_shutdown");
		const stopped = instance.renders;
		t.mock.timers.tick(10_000);
		assert.equal(instance.renders, stopped);
	});

	it("renders context limits, narrow widths, unknown usage, and full-session costs in both layouts", async (t) => {
		const instance = await app(t);
		instance.session.appendUsage("test", "test", "test", {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: {
				input: 0.25,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.25,
			},
		});
		for (const style of ["context-bar", "custom-footer"]) {
			await instance.command(style);
			assert.match(instance.render(), /\$0\.250/);
			assert.match(instance.render(), /1\.0k\/10\.0k/);
			for (const width of [1, 5, 20, 60, 100, 200])
				assert.ok(visibleWidth(instance.render(width)) <= width);
			instance.context = undefined;
			assert.match(instance.render(), /0\/20\.0k/);
			instance.context = {
				tokens: null,
				contextWindow: 10000,
				percent: null,
			};
			assert.match(instance.render(), /0\/10\.0k/);
			instance.context = {
				tokens: 1000,
				contextWindow: 10000,
				percent: 10,
			};
		}
	});
});
