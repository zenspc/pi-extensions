import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { QuietModel } from "./model.ts";
import { createQuietRenderer, type RenderContext } from "./render.ts";
import { quietTheme } from "./theme.ts";

const theme = quietTheme({
	appearance: "dark",
	getColorMode: () => "truecolor",
} as any);
const output = (text: string) => ({
	content: [{ type: "text" as const, text }],
	details: undefined,
});
function context(id: string, args = {}): RenderContext {
	return {
		toolCallId: id,
		args,
		cwd: "/repo",
		state: {},
		invalidate() {},
		lastComponent: undefined,
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		durationMs: 1,
		outputPad: 1,
	};
}
function paint(
	renderer: ToolRenderers,
	ctx: RenderContext,
	result?: ReturnType<typeof output>
): string {
	const call = renderer.renderCall!(ctx.args, theme, ctx);
	const body = result
		? renderer.renderResult!(
				result,
				{ expanded: ctx.expanded, isPartial: ctx.isPartial },
				theme,
				ctx
		  )
		: undefined;
	return stripVTControlCharacters(
		[...call.render(90), ...(body?.render(90) ?? [])].join("\n")
	);
}

test("pending rows suppress streaming stdout; success has no panel; errors break through", () => {
	const model = new QuietModel();
	const renderer = createQuietRenderer(model, () => true)(
		"bash",
		() => ({})
	)!;
	const ctx = context("a", { command: "pnpm test" });
	ctx.isPartial = true;
	assert.match(
		paint(renderer, ctx, output("LOTS OF STDOUT")),
		/Running pnpm test/
	);
	assert.doesNotMatch(
		paint(renderer, ctx, output("LOTS OF STDOUT")),
		/LOTS OF STDOUT/
	);
	ctx.isPartial = false;
	assert.match(paint(renderer, ctx, output("done")), /Ran pnpm test/);
	assert.doesNotMatch(paint(renderer, ctx, output("done")), /done/);
	ctx.isError = true;
	assert.match(
		paint(renderer, ctx, output("Command exited with code 2")),
		/exit 2/
	);
	assert.match(
		paint(renderer, ctx, output("Command exited with code 2")),
		/Command exited/
	);
});

test("hidden members have zero height and a bounded group expands with EACH original renderer", () => {
	const model = new QuietModel();
	const resolver = createQuietRenderer(model, () => true);
	const calls: string[] = [];
	const read = resolver("read", () => ({
		renderResult: (_result, _options, _theme, ctx) => {
			calls.push(`read:${ctx.toolCallId}`);
			return new Text("READ BODY", 0, 0);
		},
	}))!;
	const grep = resolver("grep", () => ({
		renderResult: () => new Text("GREP BODY", 0, 0),
	}))!;
	const find = resolver("find", () => ({
		renderResult: (_result, _options, _theme, ctx) => {
			calls.push(`find:${ctx.toolCallId}`);
			return new Text("FIND BODY", 0, 0);
		},
	}))!;
	for (let i = 0; i < 6; i++) {
		model.start(`${i}`, "read", { path: `src/${i}.ts` });
		model.end(`${i}`, "read", output(`body${i}`), false);
	}
	assert.equal(paint(read, context("0"), output("body0")), "");
	const collapsed = paint(
		read,
		context("5", { path: "src/5.ts" }),
		output("body5")
	);
	assert.match(collapsed, /Read 6 files/);
	assert.match(collapsed, /3 earlier/);
	assert.doesNotMatch(collapsed, /src\/0.ts/);
	const expanded = paint(
		read,
		{ ...context("5"), expanded: true },
		output("body5")
	);
	assert.match(expanded, /READ BODY/);
	assert.equal(calls.length, 6);
	model.start("g", "grep", { pattern: "x" });
	model.end("g", "grep", output("x"), false);
	model.start("f", "find", { pattern: "*.ts" });
	model.end("f", "find", output("file.ts"), false);
	const mixed = paint(
		find,
		{ ...context("f"), expanded: true },
		output("file.ts")
	);
	assert.match(mixed, /GREP BODY/);
	assert.match(mixed, /FIND BODY/);
	assert.equal(calls.at(-1), "find:f");
	assert.equal(paint(grep, context("g"), output("x")), "");
});

test("off delegates native state and previous components without mutating model arguments", () => {
	const model = new QuietModel();
	let enabled = true;
	const states: unknown[] = [];
	const renderer = createQuietRenderer(model, () => enabled)(
		"custom",
		() => ({
			renderShell: "self",
			renderCall: (_args, _theme, ctx) => {
				states.push(ctx.state);
				return new Text("Native call", 0, 0);
			},
			renderResult: (_result, _options, _theme, ctx) => {
				states.push(ctx.state);
				return new Text("Native body", 0, 0);
			},
		})
	)!;
	const args = { password: "private", name: "safe" };
	const ctx = context("a", args);
	assert.doesNotMatch(paint(renderer, ctx, output("result")), /Native/);
	enabled = false;
	assert.match(
		paint(renderer, ctx, output("result")),
		/Native call\s+Native body/
	);
	assert.equal(states[0], states[1]);
	assert.equal(ctx.args, args);
	assert.deepEqual(args, { password: "private", name: "safe" });
});

test("self-shell expansion preserves call-owned result bodies and shared initialization state", () => {
	const renderer = createQuietRenderer(new QuietModel(), () => true)(
		"custom",
		() => ({
			renderShell: "self",
			renderCall(_args, _theme, ctx) {
				const root = (ctx.state.root ??= new Container());
				root.clear();
				root.addChild(new Text("Original header", 0, 0));
				return root;
			},
			renderResult(_result, _options, _theme, ctx) {
				assert.ok(ctx.state.root instanceof Container);
				ctx.state.root.addChild(new Text("Call-owned body", 0, 0));
				return new Container();
			},
		})
	)!;
	const text = paint(
		renderer,
		{ ...context("a"), expanded: true },
		output("result")
	);
	assert.match(text, /Original header/);
	assert.match(text, /Call-owned body/);
});

test("original renderer failures fall back to the full text on expansion", () => {
	const renderer = createQuietRenderer(new QuietModel(), () => true)(
		"custom",
		() => ({
			renderResult() {
				throw new Error("broken");
			},
		})
	)!;
	assert.match(
		paint(
			renderer,
			{ ...context("a"), expanded: true },
			output("fallback")
		),
		/fallback/
	);
});
