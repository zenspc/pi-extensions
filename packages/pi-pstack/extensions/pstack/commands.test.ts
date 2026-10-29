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
			select: async (_title: string, options: string[]) => {
				const choice = choices.shift();
				if (!choice) return undefined;
				const option = options.find((option) => option === choice || option === `${choice} (current)`);
				assert.ok(option, `${choice} not in ${options}`);
				return option;
			},
		},
	} as unknown as Parameters<RegisteredCommand["handler"]>[1];
	return { path: configPath(), choices, notifications, context,
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

test("status shows effective models and unavailable selectors without altering config", async (t) => {
	const h = harness(t, false);
	const config = defaultConfig();
	config.roles["arena runners"] = ["inherit-parent", "openai/example", "auto"];
	config.roles["interrogate reviewers"] = ["inherit-parent", "openai/parent"];
	config.roles["bug-fix"] = "other/unavailable";
	assert.ok(saveConfig(config));
	const before = readFileSync(h.path, "utf8");
	await h.run("pstack", "status");
	const status = h.notifications.at(-1)!.text;
	assert.match(status, /Parent session model: openai\/parent/);
	assert.match(status, /arena runners: openai\/parent \(inherited\), openai\/example, openai\/parent \(inherited\)/);
	assert.match(status, /interrogate reviewers: .*\[same-model panel\]/);
	assert.match(status, /Unavailable in this session: .*other\/unavailable/);
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
