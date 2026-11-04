import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
	createAssistantMessageEventStream,
	getCurrentTools,
	type AssistantMessage,
	type Model,
	type Api,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	initTheme,
	SessionManager,
	SettingsManager,
	type ExtensionUIContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	TuiMainScreen,
	visibleWidth,
	type Terminal,
	type TUI,
	type Component,
} from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import btw from "./index.ts";
import { conversationSnapshot, SideThread } from "./thread.ts";

initTheme("dark", false);

function answer(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "btw-test",
		model: "test",
		stopReason: "stop",
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
	};
}

function controlledRequest(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions
) {
	const stream = createAssistantMessageEventStream();
	const partial = answer("");
	stream.push({ type: "start", partial });
	options?.signal?.addEventListener(
		"abort",
		() =>
			stream.push({
				type: "error",
				reason: "aborted",
				error: { ...partial, stopReason: "aborted" },
			}),
		{ once: true }
	);
	return {
		model,
		context: structuredClone(context),
		options,
		stream,
		delta(text: string) {
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: text,
				partial,
			});
		},
		finish(text: string) {
			stream.push({
				type: "done",
				reason: "stop",
				message: answer(text),
			});
		},
		toolCall() {
			stream.push({
				type: "done",
				reason: "toolUse",
				message: {
					...answer(""),
					stopReason: "toolUse",
					content: [
						{
							type: "toolCall",
							id: "bad",
							name: "write",
							arguments: { path: "/tmp/must-not-write" },
						},
					],
				},
			});
		},
		fail() {
			stream.push({
				type: "error",
				reason: "error",
				error: {
					...answer(""),
					stopReason: "error",
					errorMessage: "429 quota exhausted",
				},
			});
		},
	};
}

type Request = ReturnType<typeof controlledRequest>;

async function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pi-btw-test-"));
	const sm = SessionManager.create(root, join(root, "sessions"));
	sm.appendMessage({
		role: "user",
		content: "MAIN QUESTION",
		timestamp: Date.now(),
	});
	const assistantId = sm.appendMessage(answer("MAIN ANSWER"));
	const queued: Request[] = [];
	const waiters: ((request: Request) => void)[] = [];
	const services = await createAgentSessionServices({
		cwd: root,
		agentDir: join(root, "agent"),
		settingsManager: SettingsManager.inMemory({
			cacheWarming: "off",
			compaction: { enabled: false },
		}),
		resourceLoaderOptions: {
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			extensionFactories: [btw],
		},
	});
	services.modelRuntime.registerProvider("btw-test", {
		baseUrl: "http://127.0.0.1:1",
		api: "openai-completions",
		apiKey: "test-only",
		models: [
			{
				id: "test",
				name: "test",
				reasoning: false,
				input: ["text", "image"],
				contextWindow: 200000,
				maxTokens: 4096,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
		streamSimple(model, context, options) {
			const request = controlledRequest(model, context, options);
			const waiter = waiters.shift();
			if (waiter) waiter(request);
			else queued.push(request);
			return request.stream;
		},
	});
	const model = services.modelRuntime.getModel("btw-test", "test");
	assert.ok(model);
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: sm,
		model,
	});
	const notices: string[] = [];
	let component: Component | undefined;
	const size = { rows: 24 };
	const terminal: Terminal = {
		columns: 120,
		get rows() {
			return size.rows;
		},
		kittyProtocolActive: false,
		start() {},
		stop() {},
		async drainInput() {},
		write() {},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
		setProgramStatus() {},
	};
	const tui = new TuiMainScreen(terminal);
	const base = session.extensionRunner.createContext().ui;
	const ui: ExtensionUIContext = {
		...base,
		notify: (text) => {
			notices.push(text);
		},
		custom<T>(
			factory: (
				tui: TUI,
				theme: Theme,
				keys: KeybindingsManager,
				done: (value: T) => void
			) => Component | Promise<Component>,
			options?: Parameters<ExtensionUIContext["custom"]>[1]
		): Promise<T> {
			assert.notEqual(options?.overlay, true);
			assert.equal(options?.overlayOptions, undefined);
			return new Promise<T>((resolve, reject) => {
				// Real components/theme/key parser, without starting a terminal renderer in the test process.
				Promise.resolve(
					factory(tui, base.theme, new KeybindingsManager(), resolve)
				).then((value) => {
					component = value;
				}, reject);
			});
		},
	};
	await session.bindExtensions({ mode: "tui", uiContext: ui });
	const ctx = session.extensionRunner.createContext();
	const thread = new SideThread();
	t.after(async () => {
		thread.clear();
		await session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		await session.abort();
		session.dispose();
		tui.stop();
		rmSync(root, { recursive: true, force: true });
	});
	return {
		session,
		sm,
		ctx,
		thread,
		size,
		assistantId,
		notices,
		component: () => {
			assert.ok(component);
			return component;
		},
		nextRequest: () =>
			queued.length
				? Promise.resolve(queued.shift()!)
				: new Promise<Request>((resolve) => waiters.push(resolve)),
	};
}

test("follow-ups can be typed and submitted inside the same side panel without entering the main transcript", async (t) => {
	const { session, sm, component, nextRequest } = await fixture(t);
	const before = JSON.stringify(sm.getEntries());
	const command = session.prompt("/btw FIRST QUESTION");
	let dismissed = false;
	void command.then(() => {
		dismissed = true;
	});
	const first = await nextRequest();
	first.finish("FIRST ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	const panel = component();
	const question = "Explain [x] c in more detail";
	for (const character of question) panel.handleInput?.(character);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(dismissed, false, "typing must not dismiss the side chat");
	assert.match(
		panel.render(100).join("\n"),
		/Explain \[x\] c in more detail/
	);
	panel.handleInput?.("\r");
	const followUp = await nextRequest();
	const context = JSON.stringify(followUp.context);
	assert.match(context, /FIRST QUESTION/);
	assert.match(context, /FIRST ANSWER/);
	assert.match(context, /Explain \[x\] c in more detail/);
	assert.equal(followUp.options?.toolChoice, "none");
	followUp.finish("FOLLOW-UP ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(component(), panel, "follow-up must stay in the same panel");
	assert.match(panel.render(100).join("\n"), /FOLLOW-UP ANSWER/);
	assert.equal(dismissed, false);
	assert.equal(JSON.stringify(sm.getEntries()), before);
	panel.handleInput?.("\x1b");
	await command;
});

test("an empty side chat accepts input, keeps drafts while busy, and sanitizes pasted terminal escapes", async (t) => {
	const { session, component, nextRequest, sm } = await fixture(t);
	const before = JSON.stringify(sm.getEntries());
	const command = session.prompt("/side");
	let dismissed = false;
	void command.then(() => {
		dismissed = true;
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	const panel = component();
	panel.handleInput?.("\r");
	assert.match(panel.render(100).join("\n"), /Ask a side question below/);
	panel.handleInput?.("FIRST QUESTION");
	panel.handleInput?.("\r");
	const first = await nextRequest();
	panel.handleInput?.("NEXT DRAFT");
	panel.handleInput?.("\r");
	assert.match(panel.render(100).join("\n"), /Draft kept/);
	assert.match(panel.render(100).join("\n"), /NEXT DRAFT/);
	first.finish("FIRST ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	panel.handleInput?.("\r");
	const second = await nextRequest();
	assert.match(JSON.stringify(second.context), /FIRST ANSWER/);
	assert.match(JSON.stringify(second.context), /NEXT DRAFT/);
	second.finish("SECOND ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(dismissed, false);
	panel.handleInput?.("\x1b[200~safe \x1b[31mred\x1b[0m\x1b[201~");
	panel.handleInput?.("\r");
	const pasted = await nextRequest();
	assert.equal(pasted.context.messages.at(-1)?.content, "safe red");
	panel.handleInput?.("\x1bx");
	await command;
	assert.equal(pasted.options?.signal?.aborted, true);
	assert.equal(JSON.stringify(sm.getEntries()), before);
});

test("/side is an exact alias of /btw and shares its answers and follow-up history", async (t) => {
	const { session, sm, component, nextRequest } = await fixture(t);
	assert.equal(
		session.extensionRunner.getCommand("side")?.handler,
		session.extensionRunner.getCommand("btw")?.handler
	);
	const before = JSON.stringify(sm.getEntries());
	const ask = session.prompt("/side ALIAS QUESTION");
	const request = await nextRequest();
	request.finish("ALIAS ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	component().handleInput?.("\x1b");
	await ask;

	const reopen = session.prompt("/btw");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(component().render(80).join("\n"), /ALIAS ANSWER/);
	component().handleInput?.("\x1b");
	await reopen;

	const followUp = session.prompt("/btw FOLLOW-UP QUESTION");
	const next = await nextRequest();
	assert.match(JSON.stringify(next.context), /ALIAS QUESTION/);
	assert.match(JSON.stringify(next.context), /ALIAS ANSWER/);
	next.finish("FOLLOW-UP ANSWER");
	await new Promise<void>((resolve) => setImmediate(resolve));
	component().handleInput?.("\x1b");
	await followUp;
	const reopenAlias = session.prompt("/side");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(component().render(80).join("\n"), /FOLLOW-UP ANSWER/);
	component().handleInput?.("\x1b");
	await reopenAlias;
	assert.equal(JSON.stringify(sm.getEntries()), before);
});

test("side requests stream separately, preserve complete context, and never persist or declare tools", async (t) => {
	const { thread, ctx, sm, session, nextRequest } = await fixture(t);
	const file = sm.getSessionFile();
	assert.ok(file);
	const before = readFileSync(file, "utf8");
	const tools = session.getActiveToolNames();
	const longResult = "RESULT".repeat(1000);
	sm.appendMessage({
		role: "toolResult",
		toolCallId: "old",
		toolName: "read",
		content: [{ type: "text", text: longResult }],
		isError: false,
		timestamp: Date.now(),
	});
	const afterSetup = readFileSync(file, "utf8");
	const run = thread.ask("SIDE QUESTION", ctx);
	const request = await nextRequest();
	assert.throws(
		() => thread.ask("do not run a second request", ctx),
		/already running/
	);
	assert.equal(request.options?.toolChoice, "none");
	assert.deepEqual(getCurrentTools(request.context.messages), []);
	assert.ok(
		JSON.stringify(request.context).includes(longResult),
		"do not silently truncate tool results"
	);
	assert.ok(JSON.stringify(request.context).includes("MAIN ANSWER"));
	sm.appendMessage(answer("A LATER MAIN REPLY"));
	assert.ok(!JSON.stringify(request.context).includes("A LATER MAIN REPLY"));
	const whileRunning = readFileSync(file, "utf8");
	request.delta("partial");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(thread.exchanges[0]?.answer, "partial");
	request.finish("SIDE ANSWER");
	await run;
	assert.equal(thread.exchanges[0]?.state, "complete");
	assert.ok(whileRunning.startsWith(afterSetup));
	assert.equal(readFileSync(file, "utf8"), whileRunning);
	assert.ok(!before.includes("SIDE QUESTION"));
	assert.equal(session.sessionFile, file);
	assert.deepEqual(session.getActiveToolNames(), tools);
});

test("main and side generations run concurrently; dismissing the panel does not abort either", async (t) => {
	const { session, sm, component, nextRequest } = await fixture(t);
	const mainRun = session.prompt("MAIN IN PROGRESS");
	const main = await nextRequest();
	assert.equal(session.isIdle, false);
	const sideCommand = session.prompt("/btw SIDE WHILE BUSY");
	const side = await nextRequest();
	assert.notEqual(side.options?.signal, main.options?.signal);
	assert.equal(
		JSON.stringify(side.context).includes("MAIN IN PROGRESS"),
		true
	);
	side.delta("SIDE STREAM");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(component().render(80).join("\n"), /SIDE STREAM/);
	component().handleInput?.("\x1b");
	await sideCommand;
	assert.equal(side.options?.signal?.aborted, false);
	assert.equal(main.options?.signal?.aborted, false);
	assert.equal(session.isIdle, false);
	side.finish("SIDE COMPLETE");
	main.finish("MAIN COMPLETE");
	await mainRun;
	const transcript = JSON.stringify(sm.getEntries());
	assert.match(transcript, /MAIN COMPLETE/);
	assert.ok(!transcript.includes("SIDE WHILE BUSY"));
	assert.ok(!transcript.includes("SIDE COMPLETE"));
	const reopen = session.prompt("/btw");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(component().render(80).join("\n"), /SIDE COMPLETE/);
	component().handleInput?.("\x1b");
	await reopen;
});

test("aborting the main agent does not abort a dismissed side request", async (t) => {
	const { session, component, nextRequest } = await fixture(t);
	const mainRun = session.prompt("MAIN TO CANCEL");
	await nextRequest();
	const command = session.prompt("/btw KEEP ANSWERING");
	const side = await nextRequest();
	component().handleInput?.("\x1b");
	await command;
	await session.abort();
	await mainRun;
	assert.equal(side.options?.signal?.aborted, false);
	side.finish("SIDE SURVIVED MAIN ABORT");
	await new Promise<void>((resolve) => setImmediate(resolve));
	const reopen = session.prompt("/btw");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(component().render(80).join("\n"), /SIDE SURVIVED MAIN ABORT/);
	component().handleInput?.("\x1b");
	await reopen;
});

test("replays temporary follow-up history, caps it at 20 exchanges, and clears it independently", async (t) => {
	const { thread, ctx, nextRequest } = await fixture(t);
	for (let i = 0; i < 23; i++) {
		const run = thread.ask(`question-${i}`, ctx);
		const request = await nextRequest();
		if (i === 1) assert.match(JSON.stringify(request.context), /answer-0/);
		if (i === 22) {
			const text = JSON.stringify(request.context);
			assert.ok(!text.includes('"question-0"'));
			assert.ok(!text.includes('"question-1"'));
			assert.match(text, /answer-21/);
		}
		request.finish(`answer-${i}`);
		await run;
	}
	assert.equal(thread.exchanges.length, 20);
	const active = thread.ask("cancel this", ctx);
	const request = await nextRequest();
	thread.clear();
	await active;
	assert.equal(request.options?.signal?.aborted, true);
	assert.deepEqual(thread.exchanges, []);
});

test("history controls, small widths, long answers, and clear work without altering main history", async (t) => {
	const { session, component, nextRequest, sm, size } = await fixture(t);
	for (const question of ["first", "second"]) {
		const command = session.prompt(`/btw ${question}`);
		const request = await nextRequest();
		request.finish(`${question} answer\n` + "wide 字🙂\n".repeat(50));
		await new Promise<void>((resolve) => setImmediate(resolve));
		if (question === "second") {
			component().handleInput?.("\x1b[Z");
			assert.match(component().render(50).join("\n"), /first answer/);
			component().handleInput?.("\t");
			component().handleInput?.("\x1b[B");
			component().handleInput?.("wide draft 字🙂 ".repeat(20));
			for (const width of [1, 4, 12, 30, 80]) {
				assert.ok(
					component()
						.render(width)
						.every((line) => visibleWidth(line) <= width)
				);
			}
			for (const rows of [9, 12, 14, 24, 40, 80]) {
				size.rows = rows;
				const maxHeight = Math.max(
					7,
					Math.min(16, Math.floor(rows / 2))
				);
				assert.ok(
					component().render(40).length <= maxHeight,
					`panel must leave room for the main transcript at ${rows} rows`
				);
			}
			component().invalidate();
			component().handleInput?.("\x1bx");
		} else component().handleInput?.("\x1b");
		await command;
	}
	const empty = session.prompt("/btw");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.match(
		component().render(80).join("\n"),
		/Ask a side question below/
	);
	component().handleInput?.("\x1b");
	await empty;
	assert.ok(!JSON.stringify(sm.getEntries()).includes("first answer"));
});

test("errors remain in the panel, protocol tool calls cannot execute, and shutdown aborts only the side request", async (t) => {
	const { thread, ctx, nextRequest, session } = await fixture(t);
	let run = thread.ask("quota", ctx);
	(await nextRequest()).fail();
	await run;
	assert.equal(thread.exchanges[0]?.state, "error");
	assert.match(thread.exchanges[0]?.answer || "", /429/);
	run = thread.ask("try a tool", ctx);
	(await nextRequest()).toolCall();
	await run;
	assert.match(thread.exchanges[1]?.answer || "", /No tools were executed/);
	const command = session.prompt("/btw long side question");
	const request = await nextRequest();
	await session.extensionRunner.emit({
		type: "session_shutdown",
		reason: "reload",
	});
	await command;
	assert.equal(request.options?.signal?.aborted, true);
});

test("snapshot honors context edits and compaction without executable historical tool calls", async (t) => {
	const { sm, ctx, assistantId } = await fixture(t);
	sm.appendContextEdit(assistantId, {
		content: [{ type: "text", text: "REPLACED ANSWER" }],
	});
	let snapshot = conversationSnapshot(ctx);
	assert.ok(!JSON.stringify(snapshot).includes("MAIN ANSWER"));
	assert.match(JSON.stringify(snapshot), /REPLACED ANSWER/);
	const tool = sm.appendMessage({
		...answer(""),
		content: [
			{
				type: "toolCall",
				id: "t",
				name: "write",
				arguments: { path: "x" },
			},
		],
		stopReason: "toolUse",
	});
	sm.appendCompaction("EARLIER SUMMARY", tool, 1000);
	snapshot = conversationSnapshot(ctx);
	assert.match(JSON.stringify(snapshot), /EARLIER SUMMARY/);
	assert.ok(
		!snapshot.some(
			(message) =>
				message.role === "assistant" &&
				message.content.some((block) => block.type === "toolCall")
		)
	);
});
