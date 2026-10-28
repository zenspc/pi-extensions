import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import contextAudit from "../../extensions/context-audit/index.ts";
import { collectSnapshot } from "../../extensions/context-audit/snapshot.ts";
import { buildReport } from "../../extensions/context-audit/report.ts";
import { plainPalette, renderReport } from "../../extensions/context-audit/render.ts";
import { showReport } from "../../extensions/context-audit/viewer.ts";

function fixture(sessionManager = SessionManager.inMemory(), overrides = {}) {
	const pi = { getActiveTools: () => [], getAllTools: () => [] };
	const ctx = {
		mode: "print", sessionManager,
		getSystemPromptOptions: () => ({}), getSystemPrompt: () => "",
		getContextUsage: () => undefined, ...overrides,
	};
	return { pi, ctx, report: () => buildReport(collectSnapshot(pi as any, ctx as any)) };
}

function user(session: SessionManager, content: string) {
	return session.appendMessage({ role: "user", content, timestamp: 0 });
}

function assistant(content: any[], input = 0, timestamp = 1) {
	return { role: "assistant", content, timestamp, stopReason: "stop",
		usage: { input, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: input } } as any;
}

describe("context-audit integration", () => {
	it("registers only /ctx and notifies outside the TUI without modifying context", async () => {
		const commands = new Map<string, any>();
		const { pi, ctx } = fixture();
		contextAudit({ ...pi, registerCommand(name: string, command: any) { commands.set(name, command); } } as any);
		assert.deepEqual([...commands.keys()], ["ctx"]);
		const notifications: string[] = [];
		await commands.get("ctx").handler("", { ...ctx, ui: { notify(text: string) { notifications.push(text); } } });
		assert.equal(notifications.length, 1);
		assert.match(notifications[0], /Context audit.*no model/);
		assert.match(notifications[0], /No messages yet/);
		assert.equal(ctx.sessionManager.getEntries().length, 0);
	});

	it("honors omitted and replaced messages on the active branch", () => {
		const session = SessionManager.inMemory();
		const omitted = user(session, "omitted-secret".repeat(100));
		const edited = user(session, "original-secret".repeat(100));
		session.appendContextEdit(omitted, null);
		session.appendContextEdit(edited, { content: "temporary-secret" });
		session.appendContextEdit(edited, { content: [{ type: "text", text: "new!" }] });
		const { report } = fixture(session);
		const result = report();
		assert.equal(result.conversationChars, 4);
		assert.equal(result.conversation.blocks[0].entryId, edited);
		assert.doesNotMatch(renderReport(result, plainPalette, 110).join("\n"), /omitted-secret|original-secret|temporary-secret/);
		session.branch(edited);
		assert.equal(report().conversationChars, "omitted-secret".repeat(100).length + "original-secret".repeat(100).length);
	});

	it("projects edits to assistant, tool, and custom messages", () => {
		const session = SessionManager.inMemory();
		const reply = session.appendMessage(assistant([{ type: "text", text: "old".repeat(100) }]));
		const tool = session.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "old".repeat(100) }], isError: false, timestamp: 0 });
		const custom = session.appendCustomMessageEntry("test", "old".repeat(100), true);
		for (const id of [reply, tool, custom]) session.appendContextEdit(id, { content: "new!" });
		const result = fixture(session).report();
		assert.equal(result.conversationChars, 12);
		assert.deepEqual(result.conversation.blocks.map((b) => b.slot.kind), ["reply", "tool-result", "injected"]);
	});

	it("counts the newest compaction once, omits system checkpoints, and keeps branch summaries", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "system", content: "base", timestamp: 0 });
		user(session, "discard".repeat(100));
		const kept = user(session, "kept");
		session.appendCompaction("old-summary".repeat(100), kept, 500);
		const tail = user(session, "tail");
		session.appendCompaction("new!", kept, 600);
		session.appendContextEdit(tail, null);
		const result = fixture(session, { getSystemPrompt: () => "base" }).report();
		assert.equal(result.setupChars, 4);
		assert.equal(result.conversationChars, 8);
		assert.equal(result.totalTokens, 3);
		assert.equal(result.conversation.blocks.length, 2);
		const summary = session.branchWithSummary(kept, "branch-summary");
		const block = fixture(session).report().conversation.blocks.find((b) => b.entryId === summary);
		assert.deepEqual(block?.slot, { kind: "summary", source: "branch" });
		assert.equal(block?.chars, "branch-summary".length);
	});

	it("attributes declared tools while excluding inactive and hidden declarations", () => {
		const { ctx } = fixture(undefined, { getSystemPromptOptions: () => ({ hiddenTools: ["hidden"] }) });
		const tool = (name: string) => ({ name, description: "description", parameters: {},
			sourceInfo: { origin: "package", source: "npm:example", path: "/example/index.ts" } });
		const pi = { getActiveTools: () => ["read", "hidden"], getAllTools: () => [tool("read"), tool("hidden"), tool("inactive")] };
		const result = buildReport(collectSnapshot(pi as any, ctx as any));
		assert.equal(result.undeclaredTools, 2);
		assert.deepEqual(result.setup.map((item) => [item.label, item.origin]), [["read", "npm:example"]]);
	});

	it("calibrates estimates to provider totals, falling back to chars/4 before a reply", () => {
		const session = SessionManager.inMemory();
		user(session, "x".repeat(40));
		session.appendMessage(assistant([{ type: "text", text: "y".repeat(40) }], 110));
		const options = { getSystemPrompt: () => "s".repeat(400),
			getContextUsage: () => ({ tokens: 140, contextWindow: 1000 }) };
		const result = fixture(session, options).report();
		assert.equal(result.totalTokens, 140);
		assert.equal(result.calibrated, true);
		assert.equal(result.rates.setup, 0.25);
		assert.equal(result.rates.conversation, 0.5);
		const unmeasured = fixture(session, { ...options, getContextUsage: () => ({ tokens: 0, contextWindow: 1000 }) }).report();
		assert.equal(unmeasured.calibrated, false);
		assert.equal(unmeasured.totalTokens, 120);
	});

	it("reports repeated results and measured jumps without pricing opaque signatures", () => {
		const session = SessionManager.inMemory();
		user(session, "read the file");
		for (let i = 0; i < 2; i++) {
			session.appendMessage(assistant([
				{ type: "thinking", thinking: "plan", thinkingSignature: "s".repeat(60_000) },
				{ type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: "file.ts" } },
			], 100 + i * 2000, i + 1));
			session.appendMessage({ role: "toolResult", toolCallId: `call-${i}`, toolName: "read", content: [{ type: "text", text: "x".repeat(4000) }], isError: false, timestamp: i + 1 });
		}
		const result = fixture(session).report();
		assert.equal(result.signatureChars, 120_000);
		assert.ok(result.conversationChars < 9000);
		assert.equal(result.repeats[0].count, 2);
		assert.equal(result.repeats[0].chars, 8000);
		assert.equal(result.jumps[0].deltaTokens, 2000);
		assert.ok(result.findings.some((f) => f.text.includes("opaque thinking signatures")));
	});

	it("opens a bounded TUI overlay that scrolls, resizes, and closes without appending messages", async () => {
		const session = SessionManager.inMemory();
		user(session, "界".repeat(100));
		const { pi, ctx, report } = fixture(session);
		const before = session.getEntries().length;
		let handler: any;
		contextAudit({ ...pi, registerCommand(_name: string, command: any) { handler = command.handler; } } as any);
		let renders = 0;
		let closed = 0;
		let opened = false;
		const ui = { custom: async (factory: any, options: any) => {
			opened = true;
			assert.equal(options.overlay, true);
			assert.equal(options.overlayOptions.width, "100%");
			const tui = { terminal: { rows: 12 }, requestRender() { renders++; } };
			const theme = { bold: (text: string) => text, fg: (_color: string, text: string) => text };
			const component = factory(tui, theme, {}, () => { closed++; });
			const initial = component.render(80);
			assert.equal(initial.length, 11);
			assert.match(initial[0], /Context audit/);
			component.handleInput("j");
			assert.match(component.render(80).at(-1), /^2-/);
			component.handleInput("G");
			const bottom = component.render(80).at(-1).match(/-(\d+)\/(\d+)/);
			assert.equal(bottom[1], bottom[2]);
			component.handleInput("g");
			assert.match(component.render(80).at(-1), /^1-/);
			tui.terminal.rows = 8;
			component.invalidate();
			const narrow = component.render(24);
			assert.equal(narrow.length, 7);
			assert.ok(narrow.every((line: string) => visibleWidth(line) <= 24));
			component.handleInput("q");
		} };
		await handler("", { ...ctx, mode: "tui", ui });
		assert.equal(opened, true);
		assert.ok(renders >= 3);
		assert.equal(closed, 1);
		assert.equal(session.getEntries().length, before);
		await showReport({ ...ctx, ui } as any, report());
		assert.equal(closed, 2);
	});
});
