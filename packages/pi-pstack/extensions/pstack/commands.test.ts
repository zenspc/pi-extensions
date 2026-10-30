import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { configPath, defaultConfig, loadConfig, saveConfig } from "./config.ts";
import pstackExtension from "./index.ts";

function harness(t: TestContext, hasUI = true) {
	const dir = mkdtempSync(join(tmpdir(), "pstack-commands-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
	const notifications: { text: string; type: string }[] = [];
	const choices: string[] = [];
	const prompts: { title: string; options: string[] }[] = [];
	pstackExtension({
		on: (name: string, handler: (event: never, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
		registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
		sendMessage: (message: { content: string }) => notifications.push({ text: message.content, type: "message" }),
	} as unknown as ExtensionAPI);
	const context = {
		mode: hasUI ? "tui" : "json", hasUI, scopedModels: [],
		model: { provider: "openai", id: "parent" },
		modelRegistry: { getAvailable: () => [{ provider: "openai", id: "example" }] },
		sessionManager: { getBranch: () => [] },
		ui: {
			setStatus: () => {},
			notify: (text: string, type: string) => notifications.push({ text, type }),
			select: async (title: string, options: string[]) => {
				prompts.push({ title, options });
				const choice = choices.shift();
				if (!choice) return undefined;
				const option = options.find((option) => option === choice || option === `${choice} (current)`);
				assert.ok(option, `${choice} not in ${options}`);
				return option;
			},
		},
	} as unknown as Parameters<RegisteredCommand["handler"]>[1];
	return { path: configPath(), choices, prompts, notifications, context,
		run: (name: string, args = "") => commands.get(name)!.handler(args, context),
		start: () => handlers.get("session_start")!({} as never, context),
	};
}

test("setup preserves inherited seats before and after explicit models", async (t) => {
	for (const seats of [["inherit-parent", "openai/example", "auto"], ["openai/example", "inherit-parent"]]) {
		await t.test(seats.join(", "), async (t) => {
			const h = harness(t);
			assert.ok(saveConfig(defaultConfig()));
			h.choices.push(...Array(12).fill("inherit-parent (current)"), ...seats, "done");
			await h.run("setup-pstack");
			assert.deepEqual(loadConfig().config.roles["arena runners"], seats);
		});
	}
});

test("setup saves supported thinking effort for scalar roles and each panel seat", async (t) => {
	const h = harness(t);
	h.context.modelRegistry.getAvailable = () => [
		{ provider: "openai", id: "example", reasoning: true, thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" } },
	] as ReturnType<typeof h.context.modelRegistry.getAvailable>;
	h.choices.push("openai/example", "max", ...Array(11).fill("inherit-parent"),
		"openai/example", "off", "inherit-parent", "openai/example", "high", "done");
	await h.run("setup-pstack");
	const config = loadConfig().config;
	assert.equal(config.roles["feature, refactoring"], "openai/example:max");
	assert.deepEqual(config.roles["arena runners"], ["openai/example:off", "inherit-parent", "openai/example:high"]);
	assert.deepEqual(h.prompts.find((prompt) => prompt.title.startsWith("Thinking effort"))!.options,
		["default (current)", "off", "low", "medium", "high", "xhigh", "max"]);
});

test("setup marks current effort, can clear it, and preserves a panel on cancellation", async (t) => {
	const h = harness(t);
	h.context.modelRegistry.getAvailable = () => [
		{ provider: "openai", id: "example", reasoning: true },
	] as ReturnType<typeof h.context.modelRegistry.getAvailable>;
	const config = defaultConfig();
	config.roles["feature, refactoring"] = "openai/example:high";
	config.roles["arena runners"] = ["openai/example:low", "openai/example:high"];
	assert.ok(saveConfig(config));
	h.choices.push("openai/example (current)", "default", ...Array(11).fill("inherit-parent"),
		"openai/example (current)", "low (current)", "openai/example");
	await h.run("setup-pstack");
	assert.equal(loadConfig().config.roles["feature, refactoring"], "openai/example");
	assert.deepEqual(loadConfig().config.roles["arena runners"], config.roles["arena runners"]);
	const prompts = h.prompts.filter((prompt) => prompt.title.startsWith("Thinking effort"));
	assert.ok(prompts[0].options.includes("high (current)"));
	assert.ok(prompts[1].options.includes("low (current)"));
	assert.ok(prompts[2].options.includes("high (current)"));
	assert.ok(!prompts[0].options.includes("xhigh"));
	assert.ok(!prompts[0].options.includes("max"));
});

test("setup uses scoped model capabilities and skips effort for inheritance and non-reasoning models", async (t) => {
	const h = harness(t);
	h.context.scopedModels.push({ model: { provider: "scoped", id: "reasoner", reasoning: true } } as never);
	h.choices.push("scoped/reasoner", "high", "auto");
	await h.run("setup-pstack");
	assert.equal(loadConfig().config.roles["feature, refactoring"], "scoped/reasoner:high");
	assert.equal(loadConfig().config.roles["bug-fix"], "auto");
	assert.ok(!h.prompts[0].options.includes("openai/example"));
	h.prompts.length = 0;
	h.choices.push("inherit-parent", "openai/example");
	h.context.scopedModels.length = 0;
	await h.run("setup-pstack");
	assert.equal(loadConfig().config.roles["bug-fix"], "openai/example");
	assert.ok(h.prompts.every((prompt) => !prompt.title.startsWith("Thinking effort")));
});

test("status shows effective models and unavailable selectors without altering config", async (t) => {
	const h = harness(t, false);
	const config = defaultConfig();
	config.roles["arena runners"] = ["inherit-parent", "openai/example:high", "auto"];
	config.roles["interrogate reviewers"] = ["openai/example:low", "openai/example:high"];
	config.roles["bug-fix"] = "other/unavailable:max";
	assert.ok(saveConfig(config));
	const before = readFileSync(h.path, "utf8");
	await h.run("pstack", "status");
	const status = h.notifications.at(-1)!.text;
	assert.match(status, /Parent session model: openai\/parent/);
	assert.match(status, /arena runners: openai\/parent \(inherited\), openai\/example:high, openai\/parent \(inherited\)/);
	assert.match(status, /interrogate reviewers: .*\[same-model panel\]/);
	assert.match(status, /Unavailable in this session: other\/unavailable:max\n/);
	assert.match(status, /no extra provider is selected automatically/);
	assert.equal(readFileSync(h.path, "utf8"), before);
});

test("broken configs warn once, status diagnoses, and commands never overwrite them", async (t) => {
	for (const hasUI of [true, false]) {
		await t.test(hasUI ? "TUI" : "JSON", async (t) => {
			const h = harness(t, hasUI);
			await h.start();
			assert.deepEqual(h.notifications, [], "missing config stays quiet");
			assert.ok(saveConfig(defaultConfig()));
			for (const body of ["{private-token", '{"version":1,"roles":{"bug-fix":"bad"},"skillsEnabled":false}']) {
				writeFileSync(h.path, body);
				h.notifications.length = 0;
				await h.start();
				await h.start();
				assert.equal(h.notifications.length, 1);
				assert.match(h.notifications[0].text, /Using defaults for rejected settings/);
				assert.doesNotMatch(h.notifications[0].text, /private-token/);
				await h.run("pstack", "status");
				assert.match(h.notifications.at(-1)!.text, /Load status: (invalid|partial)/);
				assert.ok(h.notifications.at(-1)!.text.includes(h.path));
				for (const [command, args] of [["pstack", "off"], ["pstack", "on"], ["setup-pstack", ""]]) {
					await h.run(command, args);
					assert.match(h.notifications.at(-1)!.text, /Refusing to overwrite/);
					assert.equal(readFileSync(h.path, "utf8"), body);
				}
			}
		});
	}
});
