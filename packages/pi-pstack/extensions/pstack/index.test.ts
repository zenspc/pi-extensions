import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, formatSkillsForPrompt, loadSkillsFromDir, type BeforeAgentStartEvent, type ExtensionAPI, type ExtensionContext, type RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { defaultConfig, parseConfig, saveConfig } from "./config.ts";
import pstackExtension, { systemPromptInjection } from "./index.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

const SLUG_CONFIG = parseConfig({
	version: 1,
	roles: { "bug-fix": "anthropic/claude-opus-4-6" },
});

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode one-liner when the mode is on", () => {
		assert.equal(systemPromptInjection(defaultConfig(), true), POTETO_ONE_LINER);
	});

	it("injects no Poteto Mode text when the mode is off", () => {
		assert.equal(systemPromptInjection(defaultConfig(), false), "");
		assert.equal(systemPromptInjection(SLUG_CONFIG, false), "bug-fix: anthropic/claude-opus-4-6");
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, true),
			`bug-fix: anthropic/claude-opus-4-6\n\n${POTETO_ONE_LINER}`,
		);
	});
});

describe("Pi 1.4 structured prompt integration", () => {
	it("loads the extension and all skills through the Pi resource loader", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "pstack-load-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const loader = new DefaultResourceLoader({
			cwd: dir, agentDir: dir, settingsManager: SettingsManager.inMemory(),
			noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
			additionalExtensionPaths: [join(SKILLS_DIR, "..", "extensions", "pstack", "index.ts")],
			additionalSkillPaths: [SKILLS_DIR],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1);
		const commands = loader.getExtensions().extensions[0]!.commands;
		assert.deepEqual([...commands.keys()].sort(), ["poteto-mode", "pstack", "setup-pstack"]);
		assert.deepEqual(loader.getSkills().diagnostics, []);
		assert.deepEqual(
			loader.getSkills().skills.map((skill) => skill.name).sort(),
			loadSkillsFromDir({ dir: SKILLS_DIR, source: "test" }).skills.map((skill) => skill.name).sort(),
		);
	});

	it("filters only pstack prompt skills, preserves sections, and restores the catalog on the next run", async (t) => {
		const agentDir = mkdtempSync(join(tmpdir(), "pstack-pi-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		t.after(() => {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(agentDir, { recursive: true, force: true });
		});
		const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
		const commands = new Map<string, RegisteredCommand>();
		const sent: unknown[][] = [];
		const entries: unknown[][] = [];
		pstackExtension({
			on: (name: string, handler: (event: never, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
			registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
			appendEntry: (...args: unknown[]) => entries.push(args),
			sendUserMessage: (...args: unknown[]) => sent.push(args),
		} as unknown as ExtensionAPI);
		const context = {
			mode: "json", hasUI: false, isIdle: () => true,
			ui: { notify: () => {}, setStatus: () => assert.fail("JSON mode must not set TUI status") },
			sessionManager: { getBranch: () => [{ type: "custom", customType: "pstack-mode", data: { enabled: true } }] },
		} as unknown as Parameters<RegisteredCommand["handler"]>[1];
		await handlers.get("session_start")!({} as never, context);
		const loaded = loadSkillsFromDir({ dir: SKILLS_DIR, source: "test" });
		assert.deepEqual(loaded.diagnostics, []);
		const foreign = { ...loaded.skills[0]!, name: "foreign", filePath: `${SKILLS_DIR}-other/foreign/SKILL.md`, disableModelInvocation: false };
		const skills = [...loaded.skills, foreign];
		const event = (): BeforeAgentStartEvent => ({
			type: "before_agent_start", messageType: "user", prompt: "Work", systemPrompt: "Do not replace this prompt",
			systemPromptOptions: {
				cwd: agentDir, selectedTools: ["read"], hiddenTools: [], toolSnippets: {}, toolGuidelines: {},
				promptGuidelines: [], appendSystemPrompt: "", contextFiles: [], skills: [...skills],
				sections: { other_extension: "Keep me", pstack: "Stale state" },
			},
		});
		const config = defaultConfig();
		config.skillsEnabled = false;
		config.roles["bug-fix"] = "anthropic/claude-opus-4-6";
		assert.ok(saveConfig(config));
		const hidden = event();
		assert.equal(await handlers.get("before_agent_start")!(hidden as never, context), undefined);
		assert.deepEqual(hidden.systemPromptOptions.skills, [foreign]);
		assert.equal(hidden.systemPromptOptions.sections.other_extension, "Keep me");
		assert.equal(hidden.systemPromptOptions.sections.pstack, `bug-fix: anthropic/claude-opus-4-6\n\n${POTETO_ONE_LINER}`);
		assert.equal(hidden.systemPrompt, "Do not replace this prompt");
		assert.equal(skills.length, loaded.skills.length + 1, "resource registry stays intact for explicit skill commands");
		assert.doesNotMatch(formatSkillsForPrompt(hidden.systemPromptOptions.skills), /<name>how<\/name>/);
		assert.match(formatSkillsForPrompt(hidden.systemPromptOptions.skills), /<name>foreign<\/name>/);

		await commands.get("pstack")!.handler("on", context);
		const shown = event();
		await handlers.get("before_agent_start")!(shown as never, context);
		assert.equal(shown.systemPromptOptions.skills.length, skills.length);
		assert.match(formatSkillsForPrompt(shown.systemPromptOptions.skills), /<name>how<\/name>/);
		await commands.get("poteto-mode")!.handler("off", context);
		assert.ok(saveConfig(defaultConfig()));
		const off = event();
		await handlers.get("before_agent_start")!(off as never, context);
		assert.equal(off.systemPromptOptions.sections.pstack, undefined);
		assert.equal(off.systemPromptOptions.sections.other_extension, "Keep me");

		await commands.get("poteto-mode")!.handler("fix the bug", context);
		assert.deepEqual(sent, [["/skill:poteto-mode fix the bug", { expandPromptTemplates: true }]]);
		assert.deepEqual(entries, [["pstack-mode", { enabled: false }], ["pstack-mode", { enabled: true }]]);
	});
});
