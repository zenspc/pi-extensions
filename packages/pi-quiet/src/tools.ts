/**
 * Built-in tool overrides that apply Quiet Display rendering.
 *
 * Execution always delegates to pi's create*ToolDefinition for the live cwd.
 * When Sticky Preference is off, renderCall/renderResult also delegate (Stock Display).
 *
 * Run Compaction: last-member carrier with zero-height hidden members (renderShell: "self").
 */

import type {
	AgentToolResult,
	EditToolDetails,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderContext,
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
import { Container, Text } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import {
	type QuietOutcome,
	classifyQuietTool,
	textLineCount,
} from "./classify.ts";
import type { CompactionIndex, CompactionOutcomeKind } from "./compaction.ts";
import {
	formatGroupHeader,
	formatMemberBullet,
	formatMemberSummary,
	formatQuietResultLines,
	formatSingletonCallLine,
} from "./format.ts";
import {
	resultIsImageFromContent,
	resultTextFromContent,
} from "./result-content.ts";
import type { QuietToolName } from "./tools-meta.ts";

type AnyDef = ToolDefinition<any, any, any>;
type ThemeColor = "error" | "muted" | "success" | "dim" | "warning" | "toolTitle";

function resultText(result: AgentToolResult<unknown>): string {
	return resultTextFromContent(result.content);
}

function resultIsImage(result: AgentToolResult<unknown>): boolean {
	return resultIsImageFromContent(result.content);
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

function emptyComponent(): Text {
	return new Text("", 0, 0);
}

function renderQuietLines(lines: string[], theme: Theme, color: ThemeColor): Text {
	const painted = lines.map((line) => theme.fg(color, line)).join("\n");
	return new Text(painted, 0, 0);
}

function classifyFromResult(
	toolName: string,
	result: AgentToolResult<unknown>,
	isPartial: boolean,
	isError: boolean,
	args: Record<string, unknown>,
): QuietOutcome {
	const details = result.details as EditToolDetails | undefined;
	const content = typeof args.content === "string" ? args.content : "";
	return classifyQuietTool({
		toolName,
		isPartial,
		isError,
		text: resultText(result),
		isImage: resultIsImage(result),
		diff: details?.diff,
		contentLineCount: textLineCount(content),
	});
}

function settleIndex(
	index: CompactionIndex,
	toolName: string,
	toolCallId: string,
	args: Record<string, unknown>,
	result: AgentToolResult<unknown>,
	isError: boolean,
	outcome: QuietOutcome,
): void {
	if (outcome.kind === "pending") return;
	const outcomeKind = outcome.kind as CompactionOutcomeKind;
	index.onEnd({
		toolCallId,
		toolName,
		args,
		outcomeKind,
		chip: outcome.chip,
		result: {
			content: result.content as unknown[],
			details: result.details,
		},
		isError,
	});
}

function wrapBuiltin(
	pi: ExtensionAPI,
	isEnabled: () => boolean,
	index: CompactionIndex,
	createDef: (cwd: string) => AnyDef,
	toolName: QuietToolName,
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
		// Required for zero-height hidden Compaction Group members.
		renderShell: "self",

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const def = createDef(ctx.cwd);
			return def.execute(toolCallId, params, signal, onUpdate, ctx);
		},

		renderCall(args, theme, context) {
			const def = createDef(context.cwd);
			index.registerInvalidate(context.toolCallId, context.invalidate);
			index.onStart({
				toolCallId: context.toolCallId,
				toolName,
				args: args as Record<string, unknown>,
			});

			if (!isEnabled()) {
				if (def.renderCall) return def.renderCall(args, theme, context);
				return new Text(theme.fg("toolTitle", schemaDef.name), 0, 0);
			}

			const role = index.role(context.toolCallId);
			if (role.role === "hidden") {
				return emptyComponent();
			}

			const home = homedir();
			if (role.role === "carrier" && role.memberIds.length >= 2) {
				const header = formatGroupHeader(toolName, role.memberIds.length);
				return new Text(theme.fg("toolTitle", theme.bold(header)), 0, 0);
			}

			const line = formatSingletonCallLine(toolName, args as Record<string, unknown>, home);
			return new Text(theme.fg("toolTitle", theme.bold(line)), 0, 0);
		},

		renderResult(result, options, theme, context) {
			const def = createDef(context.cwd);
			const args = (context.args ?? {}) as Record<string, unknown>;
			index.registerInvalidate(context.toolCallId, context.invalidate);

			const outcome = classifyFromResult(
				toolName,
				result,
				options.isPartial,
				context.isError,
				args,
			);

			if (!options.isPartial) {
				settleIndex(index, toolName, context.toolCallId, args, result, context.isError, outcome);
			}

			if (!isEnabled()) {
				if (def.renderResult) return def.renderResult(result, options, theme, context);
				return emptyComponent();
			}

			const role = index.role(context.toolCallId);

			if (role.role === "hidden") {
				return emptyComponent();
			}

			const home = homedir();

			if (role.role === "carrier" && role.memberIds.length >= 2) {
				if (options.expanded && outcome.kind !== "pending") {
					return renderGroupExpanded(index, createDef, theme, context);
				}

				const members = index.members(context.toolCallId);
				const lines = members.map((m) =>
					formatMemberBullet(
						formatMemberSummary(m.toolName, m.args ?? {}, home),
						m.chip,
					),
				);
				// Soft members stay muted only when the whole group is soft-only; else success.
				const allSoft = members.every((m) => m.outcomeKind === "soft");
				const anyHard = members.some((m) => m.outcomeKind === "hard");
				const color: ThemeColor = anyHard ? "error" : allSoft ? "muted" : "success";
				return renderQuietLines(lines, theme, color);
			}

			// Singleton Quiet Row
			if (options.expanded && outcome.kind !== "pending") {
				if (def.renderResult) return def.renderResult(result, options, theme, context);
			}

			const showTail = outcome.kind === "hard";
			const lines = formatQuietResultLines(outcome, showTail);
			return renderQuietLines(lines, theme, colorForOutcome(outcome.kind));
		},
	});
}

function renderGroupExpanded(
	index: CompactionIndex,
	createDef: (cwd: string) => AnyDef,
	theme: Theme,
	context: ToolRenderContext<unknown, Record<string, unknown>>,
): Container {
	const container = new Container();
	const members = index.members(context.toolCallId);
	const def = createDef(context.cwd);

	// Whole-group expand: stacked Stock bodies only (header stays on renderCall).
	for (const member of members) {
		if (!member.result) continue;

		const memberResult = {
			content: member.result.content as AgentToolResult<unknown>["content"],
			details: member.result.details,
		} as AgentToolResult<unknown>;

		if (def.renderResult) {
			try {
				const memberContext = {
					...context,
					toolCallId: member.toolCallId,
					args: (member.args ?? {}) as Record<string, unknown>,
					isError: Boolean(member.isError),
					isPartial: false,
					expanded: true,
				} as ToolRenderContext<unknown, Record<string, unknown>>;
				const body = def.renderResult(
					memberResult,
					{ expanded: true, isPartial: false },
					theme,
					memberContext,
				);
				container.addChild(body);
			} catch {
				const text = resultText(memberResult);
				if (text) {
					container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
				}
			}
		} else {
			const text = resultText(memberResult);
			if (text) {
				container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
			}
		}
	}

	return container;
}

export function registerQuietTools(
	pi: ExtensionAPI,
	isEnabled: () => boolean,
	index: CompactionIndex,
): void {
	wrapBuiltin(pi, isEnabled, index, createReadToolDefinition, "read");
	wrapBuiltin(pi, isEnabled, index, createBashToolDefinition, "bash");
	wrapBuiltin(pi, isEnabled, index, createEditToolDefinition, "edit");
	wrapBuiltin(pi, isEnabled, index, createWriteToolDefinition, "write");
	wrapBuiltin(pi, isEnabled, index, createGrepToolDefinition, "grep");
	wrapBuiltin(pi, isEnabled, index, createFindToolDefinition, "find");
	wrapBuiltin(pi, isEnabled, index, createLsToolDefinition, "ls");
}
