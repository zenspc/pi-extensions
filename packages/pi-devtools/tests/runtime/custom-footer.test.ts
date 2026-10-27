import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import footerExtension from "../../extensions/custom-footer.ts";

function usage(cost: number) {
	return { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } };
}

function assistant(cost: number) {
	return { role: "assistant", content: [], usage: usage(cost), timestamp: 0 } as any;
}

async function footer(session: SessionManager) {
	const handlers = new Map<string, Function[]>();
	let component: any;
	let branchChange: () => void = () => {};
	const emit = async (name: string, event = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const ctx = {
		sessionManager: session, getContextUsage: () => undefined,
		ui: { setFooter(factory: Function) {
			component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {
				onBranchChange(fn: () => void) { branchChange = fn; return () => {}; },
				getGitBranch: () => "main",
			});
		} },
	};
	footerExtension({
		on(name: string, fn: Function) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
		getThinkingLevel: () => "off",
	} as any);
	await emit("session_start");
	return { emit, branchChange: () => branchChange(), render: () => component.render(200).join("\n") };
}

describe("footer recorded session usage", () => {
	it("includes assistant, tool, standalone, compaction, and branch-summary costs on resume", async (t) => {
		const session = SessionManager.inMemory();
		const root = session.appendMessage(assistant(0.1));
		session.appendMessage({ role: "toolResult", toolName: "codemode", toolCallId: "call", content: [], isError: false, usage: usage(0.5), timestamp: 0 });
		session.appendUsage("unknown-kind", "test", "test", usage(0.2));
		session.appendCompaction("summary", root, 100, undefined, false, usage(0.3));
		session.branchWithSummary(root, "branch", undefined, false, usage(0.4));
		const app = await footer(session);
		t.after(() => app.emit("session_shutdown"));
		assert.match(app.render(), /\$1\.500/);
		assert.match(app.render(), /↑50.*↓25/);
	});

	it("agrees for live updates and rebuilds, without counting nested tool events twice", async (t) => {
		const session = SessionManager.inMemory();
		const app = await footer(session);
		t.after(() => app.emit("session_shutdown"));
		assert.match(app.render(), /\$0\.000/);
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const message = assistant(0.1);
		await app.emit("message_start", { message });
		now += 1_000;
		const root = session.appendMessage(message);
		await app.emit("message_end", { message });
		assert.match(app.render(), /\$0\.100/);
		assert.match(app.render(), /5 t\/s/);
		await app.emit("message_end", { message });
		assert.match(app.render(), /\$0\.100/);
		await app.emit("tool_execution_end", { toolCallId: "parent/1", parentToolCallId: "parent", result: { usage: usage(0.5) } });
		const tool = { role: "toolResult", toolName: "codemode", toolCallId: "parent", content: [], isError: false, usage: usage(0.5), timestamp: 0 } as const;
		session.appendMessage(tool);
		await app.emit("message_end", { message: tool });
		assert.match(app.render(), /\$0\.600/);
		assert.match(app.render(), /5 t\/s/);
		session.appendUsage("cache_warm", "test", "test", usage(0.2));
		assert.match(app.render(), /\$0\.800/);
		app.branchChange();
		assert.match(app.render(), /\$0\.800/);
		const resumed = await footer(session);
		t.after(() => resumed.emit("session_shutdown"));
		assert.match(resumed.render(), /\$0\.800/);
		session.appendCompaction("summary", root, 100, undefined, false, usage(0.3));
		assert.match(app.render(), /\$1\.100/);
		session.branchWithSummary(root, "branch", undefined, false, usage(0.4));
		assert.match(app.render(), /\$1\.500/);
		assert.match(resumed.render(), /\$1\.500/);
	});

	it("keeps incurred usage across branch changes, including appends between renders", async (t) => {
		const session = SessionManager.inMemory();
		const root = session.appendMessage(assistant(0.1));
		const app = await footer(session);
		t.after(() => app.emit("session_shutdown"));
		assert.match(app.render(), /\$0\.100/);
		session.appendUsage("image", "test", "test", usage(0.5));
		session.branch(root);
		assert.match(app.render(), /\$0\.600/);
		session.appendMessage(assistant(0.2));
		assert.match(app.render(), /\$0\.800/);
		session.branch(root);
		app.branchChange();
		assert.match(app.render(), /\$0\.800/);
	});
});
