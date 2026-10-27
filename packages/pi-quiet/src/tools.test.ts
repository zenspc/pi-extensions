import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, Theme, ToolRenderContext, ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { CompactionIndex } from "./compaction.ts";
import { registerQuietToolRendererWrapper } from "./tools.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as Theme;

function context(): ToolRenderContext<any, any> {
	return {
		toolCallId: "read-1", args: { path: "README.md" }, cwd: process.cwd(),
		state: {}, isPartial: false, isError: false, expanded: false, invalidate() {},
	};
}

function register() {
	let enabled = true;
	let resolver: ToolRendererResolver | undefined;
	const pi = {
		registerToolRenderer(fn: ToolRendererResolver) { resolver = fn; },
	} as unknown as ExtensionAPI;
	assert.equal(registerQuietToolRendererWrapper(pi, () => enabled, new CompactionIndex()), true);
	assert.ok(resolver);
	return { resolve: resolver, disable: () => { enabled = false; } };
}

describe("Quiet tool renderer resolver", () => {
	it("uses the real tool name and keeps the next resolver reachable", () => {
		const app = register();
		let calls = 0;
		const stock: ToolRenderers = { renderCall: () => new Text("stock call", 0, 0) };
		const next: ToolRendererResolver = (name, base) => {
			assert.equal(name, "read");
			calls++;
			return base();
		};
		const renderers = app.resolve("read", () => next("read", () => stock))!;
		const lines = renderers.renderCall!({ path: "README.md" }, theme, context()).render(100).join("\n");
		assert.equal(calls, 1);
		assert.match(lines, /Read README.md/);
		assert.doesNotMatch(lines, /undefined|stock call/);
	});

	it("delegates call and result rendering when Quiet is off, preserving self shells", () => {
		const app = register();
		const call = new Text("stock call", 0, 0);
		const result = new Text("stock result", 0, 0);
		const stock: ToolRenderers = {
			renderShell: "self", renderCall: () => call, renderResult: () => result,
		};
		const renderers = app.resolve("edit", () => stock)!;
		app.disable();
		assert.equal(renderers.renderShell, "self");
		assert.equal(renderers.renderCall!({}, theme, context()), call);
		assert.equal(renderers.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: false }, theme, context()), result);
	});

	it("uses stock result rendering on expand and wraps stock default shells when off", () => {
		const app = register();
		const stock: ToolRenderers = {
			renderCall: () => new Text("stock call", 0, 0),
			renderResult: (_result, options) => new Text(options.expanded ? "stock expanded" : "stock collapsed", 0, 0),
		};
		const renderers = app.resolve("read", () => stock)!;
		const ctx = context();
		const call = renderers.renderCall!(ctx.args, theme, ctx);
		renderers.renderResult!({ content: [{ type: "text", text: "body" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx);
		assert.match(call.render(100).join("\n"), /stock expanded/);
		app.disable();
		const offCall = renderers.renderCall!(ctx.args, theme, ctx);
		renderers.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: false }, theme, ctx);
		assert.match(offCall.render(100).join("\n"), /stock call[\s\S]*stock collapsed/);
	});

	it("handles tools with no registered base renderer", () => {
		const app = register();
		const renderers = app.resolve("mcp_unknown", () => undefined)!;
		const ctx = context();
		const call = renderers.renderCall!({}, theme, ctx);
		assert.match(call.render(100).join("\n"), /mcp_unknown/);
		app.disable();
		const offCall = renderers.renderCall!({}, theme, ctx);
		assert.match(offCall.render(100).join("\n"), /mcp_unknown/);
		renderers.renderResult!({ content: [{ type: "text", text: "unknown output" }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx);
		assert.match(offCall.render(100).join("\n"), /unknown output/);
	});
});
