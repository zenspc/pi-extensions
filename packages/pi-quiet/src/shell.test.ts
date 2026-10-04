import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	TOOL_SHELL_PADDING,
	toolShellBgForQuietOutcome,
	toolShellBgForStock,
} from "./shell.ts";

describe("TOOL_SHELL_PADDING", () => {
	it("uses compact Quiet padding (tighter than Stock default 1)", () => {
		assert.equal(TOOL_SHELL_PADDING, 0);
	});
});

describe("toolShellBgForQuietOutcome", () => {
	it("maps pending / success / soft / hard to Stock tokens", () => {
		assert.equal(toolShellBgForQuietOutcome("pending"), "toolPendingBg");
		assert.equal(toolShellBgForQuietOutcome("success"), "toolSuccessBg");
		assert.equal(toolShellBgForQuietOutcome("soft"), "toolSuccessBg");
		assert.equal(toolShellBgForQuietOutcome("hard"), "toolErrorBg");
	});
});

describe("toolShellBgForStock", () => {
	it("matches ToolExecutionComponent pending / error / success", () => {
		assert.equal(toolShellBgForStock(true, false), "toolPendingBg");
		assert.equal(toolShellBgForStock(true, true), "toolPendingBg");
		assert.equal(toolShellBgForStock(false, true), "toolErrorBg");
		assert.equal(toolShellBgForStock(false, false), "toolSuccessBg");
	});
});
