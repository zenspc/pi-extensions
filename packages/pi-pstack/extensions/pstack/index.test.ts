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
	it("keeps active mode lightweight and recoverable after compaction", () => {
		const prompt = systemPromptInjection(defaultConfig(), true);
		assert.match(prompt, /Poteto Mode is ON/);
		assert.ok(prompt.includes(POTETO_ONE_LINER));
		assert.ok(prompt.includes(join(SKILLS_DIR, "poteto-mode", "SKILL.md")));
		assert.match(prompt, /read the full skill/);
		assert.doesNotMatch(prompt, /## Non-negotiables/);
	});

	it("communicates explicit off state but injects nothing before first use", () => {
		assert.equal(systemPromptInjection(defaultConfig(), undefined), "");
		assert.equal(systemPromptInjection(SLUG_CONFIG, undefined), "bug-fix: anthropic/claude-opus-4-6");
		assert.match(systemPromptInjection(defaultConfig(), false), /Poteto Mode is OFF.*Ignore earlier Poteto Mode activation/);
		assert.doesNotMatch(systemPromptInjection(defaultConfig(), false), /New task\? Playbook match/);
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, true),
			`bug-fix: anthropic/claude-opus-4-6\n\n${systemPromptInjection(defaultConfig(), true)}`,
		);
	});
});

describe("Pi 1.4 structured prompt integration", () => {
	it("updates the TUI status when tree navigation changes the active branch", async () => {
		const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
		const statuses: unknown[][] = [];
		let enabled = true;
		pstackExtension({
			on: (name: string, handler: (event: never, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
			registerCommand: () => {},
		} as unknown as ExtensionAPI);
		const context = {
			mode: "tui", ui: { setStatus: (...args: unknown[]) => statuses.push(args) },
			sessionManager: { getBranch: () => [{ type: "custom", customType: "pstack-mode", data: { enabled } }] },
		} as unknown as ExtensionContext;
		await handlers.get("session_tree")!({} as never, context);
		enabled = false;
		await handlers.get("session_tree")!({} as never, context);
		assert.deepEqual(statuses, [["pstack-mode", "pstack: poteto mode"], ["pstack-mode", undefined]]);
	});

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
		const branch = [{ type: "custom", customType: "pstack-mode", data: { enabled: true } }];
		pstackExtension({
			on: (name: string, handler: (event: never, ctx: ExtensionContext) => unknown) => handlers.set(name, handler),
			registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
			appendEntry: (customType: string, data: { enabled: boolean }) => {
				entries.push([customType, data]);
				branch.push({ type: "custom", customType, data });
			},
			getCommands: () => [{ name: "skill:poteto-mode", source: "skill" }],
			sendUserMessage: (...args: unknown[]) => sent.push(args),
			sendMessage: () => {},
		} as unknown as ExtensionAPI);
		const context = {
			mode: "json", hasUI: false, isIdle: () => true,
			ui: { notify: () => {}, setStatus: () => assert.fail("JSON mode must not set TUI status") },
			sessionManager: { getBranch: () => branch },
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
		assert.equal(hidden.systemPromptOptions.sections.pstack, systemPromptInjection(config, true));
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
		assert.match(off.systemPromptOptions.sections.pstack!, /Poteto Mode is OFF/);
		assert.equal(off.systemPromptOptions.sections.other_extension, "Keep me");

		await commands.get("poteto-mode")!.handler("fix the bug", context);
		assert.deepEqual(sent, [["/skill:poteto-mode fix the bug", { expandPromptTemplates: true }]]);
		assert.deepEqual(entries, [["pstack-mode", { enabled: false }], ["pstack-mode", { enabled: true }]]);
	});
});
