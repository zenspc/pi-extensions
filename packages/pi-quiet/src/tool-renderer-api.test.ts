import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { tryRegisterToolRenderer } from "./tool-renderer-api.ts";

describe("tryRegisterToolRenderer", () => {
	it("returns false when Pi has no registerToolRenderer seam", () => {
		const pi = { registerTool() {} } as unknown as ExtensionAPI;
		const resolve: ToolRendererResolver = (_toolName, next) => next();
		assert.equal(tryRegisterToolRenderer(pi, resolve), false);
	});

	it("registers the resolver and returns true when the seam exists", () => {
		const calls: ToolRendererResolver[] = [];
		const pi = {
			registerToolRenderer(resolve: ToolRendererResolver) { calls.push(resolve); },
		} as unknown as ExtensionAPI;
		const resolve: ToolRendererResolver = (_toolName, next) => next();
		assert.equal(tryRegisterToolRenderer(pi, resolve), true);
		assert.deepEqual(calls, [resolve]);
	});
});
