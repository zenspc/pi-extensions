import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_PATH = join(PACKAGE_DIR, "skills", "poteto-mode", "SKILL.md");
const ai = await import(join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "../../pi-ai/dist/index.js"));

test("Poteto Mode lifecycle through real Pi sessions", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "pstack-session-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = work;
	const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
	const captures: { system: string; transcript: string; users: string }[] = [];
	const errors: unknown[] = [];
	t.after(() => {
		for (const session of sessions) session.dispose();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(work, { recursive: true, force: true });
	});

	const runtime = await ModelRuntime.create({ authPath: join(work, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerProvider("pstack-test", {
		api: "openai-completions", apiKey: "test-only", baseUrl: "http://unused.invalid",
		models: [{ id: "capture", name: "Capture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1024 }],
		streamSimple(model, context) {
			captures.push({ system: ai.getCurrentSystemPrompt(context.messages), transcript: JSON.stringify(context.messages), users: JSON.stringify(context.messages.filter(message => message.role === "user")) });
			const stream = new ai.AssistantMessageEventStream();
			const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "text", text: "Captured." }], stopReason: "stop", timestamp: Date.now(), usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			stream.end();
			return stream;
		},
	});

	async function create(manager: SessionManager, withSkills = true) {
		const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 256, reserveTokens: 1024 }, retry: { enabled: false } });
		const resourceLoader = new DefaultResourceLoader({
			cwd: work, agentDir: work, settingsManager: settings,
			noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
			additionalExtensionPaths: [join(PACKAGE_DIR, "extensions", "pstack", "index.ts")],
			additionalSkillPaths: withSkills ? [join(PACKAGE_DIR, "skills")] : [],
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd: work, agentDir: work, resourceLoader, sessionManager: manager, settingsManager: settings, modelRuntime: runtime, model: runtime.getModel("pstack-test", "capture"), tools: [] });
		sessions.push(session);
		await session.bindExtensions({ mode: "json", onError: error => errors.push(error) });
		return session;
	}

	async function prompt(session: typeof sessions[number], text: string) {
		const settled = Promise.withResolvers<void>();
		const timer = setTimeout(() => settled.reject(new Error(`No model run for ${text}`)), 2000);
		const unsubscribe = session.subscribe(event => { if (event.type === "agent_settled") settled.resolve(); });
		try {
			await session.prompt(text);
			await settled.promise;
			await session.waitForIdle();
		} finally {
			clearTimeout(timer);
			unsubscribe();
		}
	}

	function latest() {
		const capture = captures.at(-1);
		assert.ok(capture);
		return capture;
	}

	const manager = SessionManager.create(work, join(work, "sessions"));
	let session = await create(manager);
	await prompt(session, "Initial ordinary turn");
	const offLeaf = manager.getLeafId()!;
	await prompt(session, "/poteto-mode Investigate the parser");
	const onLeaf = manager.getLeafId()!;
	await t.test("activation expands the hidden skill and forwards the task", () => {
		assert.match(latest().users, /## Non-negotiables/);
		assert.match(latest().users, /Investigate the parser/);
	});
	await session.prompt("/poteto-mode off");
	await prompt(session, "Turn after disabling");
	await t.test("off is explicit in model context despite historical activation", () => {
		assert.match(latest().system, /Poteto Mode is OFF/);
		assert.doesNotMatch(latest().system, /New task\? Playbook match/);
	});
	await prompt(session, "/skill:poteto-mode Direct activation");
	const saved = manager.getSessionFile()!;
	session.dispose();
	session = await create(SessionManager.open(saved));
	await prompt(session, "Turn after disk resume");
	await t.test("disk resume restores the active mode", () => assert.match(latest().system, /New task\? Playbook match/));
	await session.navigateTree(offLeaf, { summarize: false });
	await prompt(session, "Original off branch");
	await t.test("tree navigation restores the mode-off branch", () => assert.doesNotMatch(latest().system, /New task\? Playbook match/));
	await session.prompt("/poteto-mode off");
	await session.navigateTree(onLeaf, { summarize: false });
	await prompt(session, "Original on branch");
	await t.test("tree navigation restores the mode-on branch", () => assert.match(latest().system, /New task\? Playbook match/));
	for (const task of ["stop the parser crash", "disable flaky test retries", "off by one in the parser"]) {
		await t.test(`forwards task ${JSON.stringify(task)}`, async () => {
			await prompt(session, `/poteto-mode ${task}`);
			assert.ok(latest().users.includes(task));
		});
	}
	await prompt(session, "/skill:poteto-mode Prepare for compaction");
	for (let i = 0; i < 6; i++) await prompt(session, `Intermediate turn ${i}. ${"filler ".repeat(250)}`);
	await session.compact();
	await prompt(session, "New rigorous task after compaction");
	await t.test("active mode retains its absolute skill entry point after compaction", () => {
		assert.doesNotMatch(latest().transcript, /## Non-negotiables/);
		assert.ok(latest().system.includes(SKILL_PATH));
		assert.match(latest().system, /read.*skill|read.*SKILL/i);
	});
	const missing = await create(SessionManager.inMemory(work), false);
	for (const command of ["/poteto-mode Missing resources", "/skill:poteto-mode Missing resources"]) {
		await t.test(`rejects ${command} without the skill`, async () => {
			const before = captures.length;
			await missing.prompt(command);
			await missing.waitForIdle();
			assert.equal(captures.length, before, "no unexpanded slash text should reach the model");
			assert.ok(!missing.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "pstack-mode"));
			assert.ok(missing.messages.some(message => message.role === "custom" && message.customType === "pstack-error" && String(message.content).includes("Load the full pi-pstack package")));
		});
	}
	assert.deepEqual(errors, []);
});
