/**
 * Built-in tool overrides that apply Quiet Display rendering.
 *
 * Execution always delegates to pi's create*ToolDefinition for the live cwd.
 * When Sticky Preference is off, renderCall/renderResult also delegate (Stock Display).
 */

import type {
	AgentToolResult,
	EditToolDetails,
	ExtensionAPI,
	Theme,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import {
	type ExploreTool,
	type QuietOutcome,
	classifyBashOutcome,
	classifyEditOutcome,
	classifyExploreOutcome,
	classifyReadOutcome,
	classifyWriteOutcome,
	textLineCount,
} from "./classify.ts";
import { formatCallSummary, formatQuietResultLines } from "./format.ts";

type AnyDef = ToolDefinition<any, any, any>;
type ThemeColor = "error" | "muted" | "success" | "dim" | "warning" | "toolTitle";

function resultText(result: AgentToolResult<unknown>): string {
	const block = result.content.find((c) => c.type === "text");
	return block && block.type === "text" ? block.text : "";
}

function resultIsImage(result: AgentToolResult<unknown>): boolean {
	return result.content.some((c) => c.type === "image");
}

function colorForOutcome(kind: QuietOutcome["kind"]): ThemeColor {
	switch (kind) {
		case "hard":
			return "error";
		case "soft":
			return "muted";
		case "pending":
			return "dim";
		default:
			return "success";
	}
}

function renderQuietLines(lines: string[], theme: Theme, color: ThemeColor): Text {
	const painted = lines.map((line) => theme.fg(color, line)).join("\n");
	return new Text(painted, 0, 0);
}

function wrapBuiltin(
	pi: ExtensionAPI,
	isEnabled: () => boolean,
	createDef: (cwd: string) => AnyDef,
	classify: (input: {
		result: AgentToolResult<unknown>;
		isPartial: boolean;
		isError: boolean;
		args: Record<string, unknown>;
	}) => QuietOutcome,
	toolName: string,
): void {
	const schemaDef = createDef(process.cwd());

	pi.registerTool({
		name: schemaDef.name,
		label: schemaDef.label,
		description: schemaDef.description,
		promptSnippet: schemaDef.promptSnippet,
		promptGuidelines: schemaDef.promptGuidelines,
		parameters: schemaDef.parameters,
		executionMode: schemaDef.executionMode,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const def = createDef(ctx.cwd);
			return def.execute(toolCallId, params, signal, onUpdate, ctx);
		},

		renderCall(args, theme, context) {
			const def = createDef(context.cwd);
			if (!isEnabled()) {
				if (def.renderCall) return def.renderCall(args, theme, context);
				return new Text(theme.fg("toolTitle", schemaDef.name), 0, 0);
			}
			const line = formatCallSummary(toolName, args as Record<string, unknown>, homedir());
			return new Text(theme.fg("toolTitle", theme.bold(line)), 0, 0);
		},

		renderResult(result, options, theme, context) {
			const def = createDef(context.cwd);
			if (!isEnabled()) {
				if (def.renderResult) return def.renderResult(result, options, theme, context);
				return new Text("", 0, 0);
			}

			const outcome = classify({
				result,
				isPartial: options.isPartial,
				isError: context.isError,
				args: (context.args ?? {}) as Record<string, unknown>,
			});

			// User expand → full Stock Display body (honesty contract).
			if (options.expanded && outcome.kind !== "pending") {
				if (def.renderResult) return def.renderResult(result, options, theme, context);
			}

			// Hard Breakthrough auto-shows a capped tail even when collapsed.
			const showTail = outcome.kind === "hard";
			const lines = formatQuietResultLines(outcome, showTail);
			return renderQuietLines(lines, theme, colorForOutcome(outcome.kind));
		},
	});
}

export function registerQuietTools(pi: ExtensionAPI, isEnabled: () => boolean): void {
	wrapBuiltin(
		pi,
		isEnabled,
		createReadToolDefinition,
		({ result, isPartial, isError }) =>
			classifyReadOutcome({
				isPartial,
				isError,
				text: resultText(result),
				isImage: resultIsImage(result),
			}),
		"read",
	);

	wrapBuiltin(
		pi,
		isEnabled,
		createBashToolDefinition,
		({ result, isPartial, isError }) =>
			classifyBashOutcome({
				isPartial,
				isError,
				text: resultText(result),
			}),
		"bash",
	);

	wrapBuiltin(
		pi,
		isEnabled,
		createEditToolDefinition,
		({ result, isPartial, isError }) => {
			const details = result.details as EditToolDetails | undefined;
			return classifyEditOutcome({
				isPartial,
				isError,
				diff: details?.diff,
				text: resultText(result),
			});
		},
		"edit",
	);

	wrapBuiltin(
		pi,
		isEnabled,
		createWriteToolDefinition,
		({ result, isPartial, isError, args }) => {
			const content = typeof args.content === "string" ? args.content : "";
			return classifyWriteOutcome({
				isPartial,
				isError,
				contentLineCount: textLineCount(content),
				text: resultText(result),
			});
		},
		"write",
	);

	const explore: Array<{
		name: ExploreTool;
		create: (cwd: string) => AnyDef;
	}> = [
		{ name: "grep", create: createGrepToolDefinition },
		{ name: "find", create: createFindToolDefinition },
		{ name: "ls", create: createLsToolDefinition },
	];

	for (const { name, create } of explore) {
		wrapBuiltin(
			pi,
			isEnabled,
			create,
			({ result, isPartial, isError }) =>
				classifyExploreOutcome({
					tool: name,
					isPartial,
					isError,
					text: resultText(result),
				}),
			name,
		);
	}
}
