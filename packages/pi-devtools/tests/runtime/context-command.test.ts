import assert from "node:assert/strict";
import { mock, describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import contextCommand from "../../extensions/context-command.ts";

async function report(sessionManager: SessionManager, overrides = {}) {
	let handler: any;
	contextCommand({
		registerCommand(_name: string, command: any) { handler = command.handler; },
		getActiveTools: () => [], getAllTools: () => [],
	} as any);
	const log = mock.method(console, "log", () => {});
	try {
		await handler("json", {
			mode: "print", hasUI: false, sessionManager,
			getSystemPrompt: () => "", ...overrides,
		});
		assert.equal(log.mock.calls.length, 1);
		return JSON.parse(log.mock.calls[0].arguments[0]);
	} finally {
		log.mock.restore();
	}
}

function user(session: SessionManager, content: string) {
	return session.appendMessage({ role: "user", content, timestamp: 0 });
}

function tokensFor(result: any, role: string) {
	return result.conversation.byRole.find((item: any) => item.label === role)?.tokens ?? 0;
}

describe("/context canonical session projection", () => {
	it("omits edited messages without calling them compacted or leaking bodies", async () => {
		const session = SessionManager.inMemory();
		const id = user(session, "private-message-".repeat(1000));
		session.appendContextEdit(id, null);
		const result = await report(session);
		assert.equal(result.total, 0);
		assert.equal(result.mode, "conversation");
		assert.equal(result.conversation.entries, 0);
		assert.equal(result.conversation.branchMessages, 1);
		assert.equal(result.conversation.excludedByCompaction, 0);
		assert.equal(result.conversation.excludedByContextEdits, 1);
		assert.doesNotMatch(JSON.stringify(result), /private-message/);
	});

	it("uses the latest string or block replacement and retains source IDs", async () => {
		const session = SessionManager.inMemory();
		const id = user(session, "original-secret".repeat(100));
		session.appendContextEdit(id, { content: "temporary-secret".repeat(50) });
		session.appendContextEdit(id, { content: [{ type: "text", text: "replacement-secret" }] });
		const result = await report(session);
		assert.equal(tokensFor(result, "user"), Math.ceil("replacement-secret".length / 4));
		assert.equal(result.conversation.entries, 1);
		assert.equal(result.conversation.entriesDetail[0].id, id);
		assert.doesNotMatch(JSON.stringify(result), /original-secret|temporary-secret|replacement-secret/);
		session.branch(id);
		assert.equal(tokensFor(await report(session), "user"), Math.ceil("original-secret".repeat(100).length / 4));
	});

	it("normalizes assistant/tool strings and edits custom messages using the host projection", async () => {
		const session = SessionManager.inMemory();
		const assistant = session.appendMessage({ role: "assistant", content: [{ type: "text", text: "old".repeat(100) }], timestamp: 0 } as any);
		const tool = session.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "old".repeat(100) }], isError: false, timestamp: 0 });
		const custom = session.appendCustomMessageEntry("test", "old".repeat(100), true);
		session.appendContextEdit(assistant, { content: "new!" });
		session.appendContextEdit(tool, { content: "new!" });
		session.appendContextEdit(custom, { content: [{ type: "text", text: "new!" }] });
		const result = await report(session);
		assert.equal(tokensFor(result, "assistant"), 1);
		assert.equal(tokensFor(result, "toolResult"), 3); // read + space + new!
		assert.equal(tokensFor(result, "custom_message:test"), 1);
		assert.equal(result.total, 5);
	});

	it("counts only the newest compaction summary and does not repeat the system checkpoint", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "system", content: "base", timestamp: 0 });
		user(session, "discard".repeat(100));
		const kept = user(session, "kept");
		session.appendCompaction("old-summary".repeat(100), kept, 500);
		const tail = user(session, "tail");
		session.appendCompaction("new!", kept, 600);
		session.appendContextEdit(tail, null);
		const result = await report(session, { getSystemPrompt: () => "base" });
		assert.equal(tokensFor(result, "compaction"), 1);
		assert.equal(tokensFor(result, "user"), 1);
		assert.equal(result.total, 3); // startup base + kept + newest summary
		assert.equal(result.conversation.excludedByCompaction, 2); // system + discarded user
		assert.equal(result.conversation.excludedByContextEdits, 1);
		assert.equal(result.conversation.entriesDetail.length, 2);
	});

	it("counts a branch summary once and retains its navigation metadata", async () => {
		const session = SessionManager.inMemory();
		const root = user(session, "root");
		user(session, "abandoned".repeat(100));
		const summary = session.branchWithSummary(root, "branch-private");
		const result = await report(session);
		assert.equal(tokensFor(result, "branch_summary"), Math.ceil("branch-private".length / 4));
		assert.equal(result.conversation.entriesDetail.find((item: any) => item.id === summary).chars, "branch-private".length);
		assert.doesNotMatch(JSON.stringify(result), /branch-private|abandoned/);
	});

	it("uses measured aggregate usage even when category estimates are larger", async () => {
		const session = SessionManager.inMemory();
		user(session, "x".repeat(400));
		const result = await report(session, { getContextUsage: () => ({ tokens: 20, percent: 2, contextWindow: 1000 }) });
		assert.equal(result.total, 20);
		assert.equal(result.estimatedTotal, 100);
		assert.equal(result.free, 980);
		assert.equal(tokensFor(result, "user"), 100);
		assert.match(result.estimateNote, /measured.*estimat/i);
	});
});
