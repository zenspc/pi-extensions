import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { browserTool } from "./browser-tool.ts";
import { decide, installDomainGate, promptOutcome } from "./gate.ts";

type SelectSpy = {
	calls: { title: string; options: string[] }[];
	respondWith: string[];
};

function fakePi() {
	let toolCallHandler:
		| ((event: ToolCallEvent, ctx: ExtensionContext) => Promise<ToolCallEventResult | undefined>)
		| undefined;
	const registered: { name: string }[] = [];
	const pi = {
		on(_event: string, handler: typeof toolCallHandler) {
			toolCallHandler = handler;
		},
		registerTool(def: { name: string }) {
			registered.push(def);
		},
	} as unknown as ExtensionAPI;
	const callGate = (
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> => {
		assert.ok(toolCallHandler, "tool_call handler was not registered");
		return toolCallHandler(event, ctx);
	};
	return { pi, callGate, registered };
}

function fakeCtx(options?: {
	hasUI?: boolean;
	select?: (title: string, optionsList: string[]) => Promise<string | undefined>;
}): ExtensionContext {
	return {
		hasUI: options?.hasUI ?? true,
		ui: { select: options?.select ?? (async () => "Approve once") },
	} as unknown as ExtensionContext;
}

function selectSpy(respondWith: string): { spy: SelectSpy; select: (title: string) => Promise<string> } {
	const spy: SelectSpy = { calls: [], respondWith: [respondWith] };
	return {
		spy,
		select: async (title: string) => {
			spy.calls.push({ title, options: ["Approve once", "Approve permanently", "Deny"] });
			return spy.respondWith[0];
		},
	};
}

function navigateEvent(url: string): ToolCallEvent {
	return {
		type: "tool_call",
		toolCallId: `call-${Math.random()}`,
		toolName: "browser_navigate",
		input: { url },
	} as ToolCallEvent;
}

describe("decide", () => {
	it("asks for unknown domains and passes approved ones", () => {
		const allowed = new Set(["example.com"]);
		assert.equal(decide("example.com", allowed), "pass");
		assert.equal(decide("other.com", allowed), "ask");
	});
});

describe("promptOutcome", () => {
	it("maps UI choices, treating dismissal as deny", () => {
		assert.equal(promptOutcome("Approve once"), "once");
		assert.equal(promptOutcome("Approve permanently"), "permanent");
		assert.equal(promptOutcome("Deny"), "deny");
		assert.equal(promptOutcome(undefined), "deny");
		assert.equal(promptOutcome("garbage"), "deny");
	});
});

describe("installDomainGate", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-gate-"));
	const allowlistPath = join(dir, "allowlist.json");
	after(() => rmSync(dir, { recursive: true, force: true }));

	function setup(selectResponse?: string) {
		const { pi, callGate, registered } = fakePi();
		installDomainGate(pi, { allowlistPath });
		const prompt = selectSpy(selectResponse ?? "Approve once");
		browserTool(pi, {
			name: "browser_navigate",
			label: "Browser Navigate",
			description: "test tool",
			parameters: Type.Object({ url: Type.String() }),
			async execute() {
				return { content: [], details: undefined };
			},
		});
		return { callGate, registered, spy: prompt.spy, select: prompt.select };
	}

	it("registers exactly one handler and wraps tool registration", async () => {
		const { registered, spy, callGate, select } = setup();
		assert.equal(registered.length, 1);
		assert.equal(registered[0].name, "browser_navigate");

		const result = await callGate(navigateEvent("https://firsttouch.com/page"), fakeCtx({ select }));
		assert.equal(result, undefined);
		assert.equal(spy.calls.length, 1);
		assert.match(spy.calls[0].title, /firsttouch\.com/);
		assert.deepEqual(spy.calls[0].options, ["Approve once", "Approve permanently", "Deny"]);
	});

	it("approve-once holds for later calls in-session without re-prompting", async () => {
		const { callGate, spy, select } = setup("Approve once");
		await callGate(navigateEvent("https://holdonce.com/a"), fakeCtx({ select }));
		const again = await callGate(
			navigateEvent("https://sub.holdonce.com/b"),
			fakeCtx({ select }),
		);
		assert.equal(again, undefined);
		assert.equal(spy.calls.length, 1);

		const other = await callGate(navigateEvent("https://other.net/"), fakeCtx({ select }));
		assert.equal(other, undefined);
		assert.equal(spy.calls.length, 2);
		assert.match(spy.calls[1].title, /other\.net/);
	});

	it("approve-permanent persists to disk and pre-approves a fresh gate", async () => {
		const first = setup("Approve permanently");
		const result = await first.callGate(
			navigateEvent("https://persisted.dev/x"),
			fakeCtx({ select: first.select }),
		);
		assert.equal(result, undefined);
		assert.ok(existsSync(allowlistPath));
		const parsed = JSON.parse(readFileSync(allowlistPath, "utf8")) as {
			version: number;
			domains: string[];
		};
		assert.deepEqual(parsed, { version: 1, domains: ["persisted.dev"] });

		const second = setup();
		const fresh = await second.callGate(
			navigateEvent("https://sub.persisted.dev/y"),
			fakeCtx({ select: second.select }),
		);
		assert.equal(fresh, undefined);
		assert.equal(second.spy.calls.length, 0);
	});

	it("deny blocks with a clear message and re-prompts on the next call", async () => {
		const denied = setup("Deny");
		const result = await denied.callGate(
			navigateEvent("https://denied.com/page"),
			fakeCtx({ select: denied.select }),
		);
		assert.deepEqual(result, { block: true, reason: "User denied browser access to denied.com." });

		const next = await denied.callGate(
			navigateEvent("https://denied.com/page"),
			fakeCtx({ select: denied.select }),
		);
		assert.deepEqual(next, { block: true, reason: "User denied browser access to denied.com." });
		assert.equal(denied.spy.calls.length, 2);
	});

	it("blocks headless calls while naming the allowlist path and never prompts", async () => {
		const gate = setup();
		const result = await gate.callGate(
			navigateEvent("https://headless.com/page"),
			fakeCtx({ hasUI: false, select: gate.select }),
		);
		assert.ok(result?.block);
		assert.match(result.reason ?? "", /headless\.com/);
		assert.match(result.reason ?? "", new RegExp(allowlistPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	});

	it("allows about:blank without a Domain Approval prompt", async () => {
		const gate = setup();
		const result = await gate.callGate(
			navigateEvent("about:blank"),
			fakeCtx({ select: gate.select }),
		);
		assert.equal(result, undefined);
		assert.equal(gate.spy.calls.length, 0);
	});

	it("blocks other about URLs and non-http(s) schemes before prompting", async () => {
		const gate = setup();
		for (const url of [
			"about:srcdoc",
			"file:///tmp/x",
			"data:text/html,hi",
			"javascript:alert(1)",
			"blob:https://example.com/uuid",
			"chrome://settings",
		]) {
			const result = await gate.callGate(navigateEvent(url), fakeCtx({ select: gate.select }));
			assert.ok(result?.block, url);
			assert.match(result.reason ?? "", /not an allowed site/, url);
		}
		assert.equal(gate.spy.calls.length, 0);
	});

	it("fails closed for a public suffix and ignores that row on the Allowlist", async () => {
		const isolated = join(dir, "psl-allowlist.json");
		writeFileSync(isolated, `${JSON.stringify({ version: 1, domains: ["github.io"] })}\n`);
		const { pi, callGate } = fakePi();
		installDomainGate(pi, { allowlistPath: isolated });
		const prompt = selectSpy("Approve once");
		browserTool(pi, {
			name: "browser_navigate",
			label: "Browser Navigate",
			description: "test tool",
			parameters: Type.Object({ url: Type.String() }),
			async execute() {
				return { content: [], details: undefined };
			},
		});

		const suffix = await callGate(
			navigateEvent("https://github.io/"),
			fakeCtx({ select: prompt.select }),
		);
		assert.ok(suffix?.block);
		assert.equal(prompt.spy.calls.length, 0);
		assert.deepEqual(JSON.parse(readFileSync(isolated, "utf8")), {
			version: 1,
			domains: ["github.io"],
		});

		const tenant = await callGate(
			navigateEvent("https://foo.github.io/"),
			fakeCtx({ select: prompt.select }),
		);
		assert.equal(tenant, undefined);
		assert.equal(prompt.spy.calls.length, 1);
		assert.match(prompt.spy.calls[0].title, /foo\.github\.io/);
	});

	it("does not split a grant by scheme or port", async () => {
		const gate = setup("Approve once");
		await gate.callGate(
			navigateEvent("https://sharedport.com:8443/a"),
			fakeCtx({ select: gate.select }),
		);
		const again = await gate.callGate(
			navigateEvent("http://sharedport.com:8080/b"),
			fakeCtx({ select: gate.select }),
		);
		assert.equal(again, undefined);
		assert.equal(gate.spy.calls.length, 1);
		assert.match(gate.spy.calls[0].title, /sharedport\.com/);
	});

	it("blocks malformed URLs instead of guessing a domain", async () => {
		const gate = setup();
		const result = await gate.callGate(navigateEvent("not-a-url"), fakeCtx());
		assert.ok(result?.block);
		assert.match(result.reason ?? "", /not a valid URL/);
	});

	it("passes non-browser tools through untouched", async () => {
		const gate = setup();
		const event = {
			type: "tool_call",
			toolCallId: "call-1",
			toolName: "bash",
			input: { command: "ls" },
		} as ToolCallEvent;
		const result = await gate.callGate(event, fakeCtx({ select: gate.select }));
		assert.equal(result, undefined);
		assert.equal(gate.spy.calls.length, 0);
	});

	it("treats a missing url param as malformed and blocks", async () => {
		const gate = setup();
		const result = await gate.callGate(
			navigateEvent(""),
			fakeCtx({ select: gate.select }),
		);
		assert.ok(result?.block);
	});

	it("blocks when the gate itself errors (UI failure is fail-safe)", async () => {
		const gate = setup();
		const failingCtx = fakeCtx({
			select: async () => {
				throw new Error("UI exploded");
			},
		});
		const result = await gate.callGate(
			navigateEvent("https://crashy.com/"),
			failingCtx,
		);
		assert.ok(result?.block);
		assert.match(result.reason ?? "", /domain gate failed/);
		assert.match(result.reason ?? "", /UI exploded/);
	});
});

function actionEvent(toolName: string): ToolCallEvent {
	return {
		type: "tool_call",
		toolCallId: `call-${Math.random()}`,
		toolName,
		input: { ref: "e1", text: "hello" },
	} as ToolCallEvent;
}

describe("gated action tools", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-actions-"));
	const allowlistPath = join(dir, "allowlist.json");
	after(() => rmSync(dir, { recursive: true, force: true }));

	function setup(selectResponse?: string) {
		const { pi, callGate, registered } = fakePi();
		installDomainGate(pi, { allowlistPath });
		for (const name of ["browser_click", "browser_type"]) {
			browserTool(pi, {
				name,
				label: name,
				description: "test tool",
				parameters: Type.Object({ ref: Type.String() }),
				urlFrom: async () => `https://${name}.example/action`,
				async execute() {
					return { content: [], details: undefined };
				},
			});
		}
		const prompt = selectSpy(selectResponse ?? "Approve once");
		return { callGate, registered, spy: prompt.spy, select: prompt.select };
	}

	it("registers browser_click and browser_type behind the gate", async () => {
		const gate = setup();
		assert.deepEqual(gate.registered.map((def) => def.name), [
			"browser_click",
			"browser_type",
		]);

		const result = await gate.callGate(
			actionEvent("browser_click"),
			fakeCtx({ select: gate.select }),
		);
		assert.equal(result, undefined);
		assert.equal(gate.spy.calls.length, 1);
		assert.match(gate.spy.calls[0].title, /browser_click\.example/);
	});

	it("resolves the async extractor per tool before prompting", async () => {
		const gate = setup("Approve once");
		await gate.callGate(actionEvent("browser_type"), fakeCtx({ select: gate.select }));
		assert.match(gate.spy.calls[0].title, /browser_type\.example/);

		const again = await gate.callGate(
			actionEvent("browser_type"),
			fakeCtx({ select: gate.select }),
		);
		assert.equal(again, undefined);
		assert.equal(gate.spy.calls.length, 1);
	});

	it("blocks unapproved action tools without UI after resolving their URL", async () => {
		const gate = setup();
		const result = await gate.callGate(
			actionEvent("browser_click"),
			fakeCtx({ hasUI: false, select: gate.select }),
		);
		assert.ok(result?.block);
		assert.match(result.reason ?? "", /browser_click\.example/);
		assert.match(result.reason ?? "", new RegExp(allowlistPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(gate.spy.calls.length, 0);
	});

	it("blocks fail-safe when an async extractor rejects", async () => {
		const { pi, callGate } = fakePi();
		installDomainGate(pi, { allowlistPath });
		const prompt = selectSpy("Approve once");
		browserTool(pi, {
			name: "browser_explode",
			label: "Browser Explode",
			description: "test tool",
			parameters: Type.Object({}),
			urlFrom: async () => {
				throw new Error("tab vanished");
			},
			async execute() {
				return { content: [], details: undefined };
			},
		});
		const result = await callGate(
			{
				type: "tool_call",
				toolCallId: "call-1",
				toolName: "browser_explode",
				input: {},
			} as ToolCallEvent,
			fakeCtx({ select: prompt.select }),
		);
		assert.ok(result?.block);
		assert.match(result.reason ?? "", /domain gate failed/);
		assert.match(result.reason ?? "", /tab vanished/);
	});
});
