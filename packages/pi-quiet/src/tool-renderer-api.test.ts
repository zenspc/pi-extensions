import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type ToolRendererWrapper,
	tryRegisterToolRenderer,
} from "./tool-renderer-api.ts";

describe("tryRegisterToolRenderer", () => {
	it("returns false when Pi has no registerToolRenderer seam", () => {
		const pi = {
			registerTool() {},
		} as unknown as ExtensionAPI;
		const wrap: ToolRendererWrapper = (_tool, renderers) => renderers;
		assert.equal(tryRegisterToolRenderer(pi, wrap), false);
	});

	it("registers the wrapper and returns true when the seam exists", () => {
		const calls: ToolRendererWrapper[] = [];
		const pi = {
			registerToolRenderer(wrap: ToolRendererWrapper) {
				calls.push(wrap);
			},
		} as unknown as ExtensionAPI;
		const wrap: ToolRendererWrapper = (_tool, renderers) => renderers;
		assert.equal(tryRegisterToolRenderer(pi, wrap), true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0], wrap);
	});
});
