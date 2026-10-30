import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import pstackExtension from "./index.ts";

test("Poteto command awaits an awaitable host send and forwards exactly once", async () => {
	for (const [mode, idle, mustWait] of [["json", true, true], ["print", true, true], ["json", false, true], ["rpc", true, false], ["tui", true, false]] as const) {
		const commands = new Map<string, RegisteredCommand>();
		const sent: unknown[][] = [];
		const completion = Promise.withResolvers<void>();
		pstackExtension({
			on: () => {},
			registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
			getCommands: () => [{ name: "skill:poteto-mode", source: "skill" }],
			appendEntry: () => {},
			sendUserMessage: (...args: unknown[]) => { sent.push(args); return completion.promise; },
		} as unknown as ExtensionAPI);
		const ctx = {
			mode, isIdle: () => idle, ui: { notify: () => {}, setStatus: () => {} },
		} as unknown as Parameters<RegisteredCommand["handler"]>[1];
		let finished = false;
		const command = commands.get("poteto-mode")!.handler("Fix numeric sorting", ctx).then(() => { finished = true; });
		await setImmediate();
		assert.equal(finished, !mustWait, `${mode} must preserve its command acknowledgment contract`);
		assert.deepEqual(sent, [["/skill:poteto-mode Fix numeric sorting", {
			expandPromptTemplates: true, ...(!idle ? { deliverAs: "followUp" } : {}),
		}]]);
		completion.resolve();
		await command;
		assert.equal(finished, true);
		await commands.get("poteto-mode")!.handler("off", ctx);
		assert.equal(sent.length, 1, "off never starts a model turn");
	}
});
