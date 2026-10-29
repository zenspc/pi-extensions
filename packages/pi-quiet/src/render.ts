import type {
	AgentToolResult,
	Theme,
	ToolRenderers,
	ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";
import {
	failureTail,
	groupKind,
	groupSummary,
	summarize,
	type Summary,
} from "./format.ts";
import { classify, QuietModel, type Row } from "./model.ts";
import { resultTextFromContent } from "./result-content.ts";

export type RenderContext<State = Record<string, unknown>> = Omit<
	Parameters<NonNullable<ToolRenderers["renderCall"]>>[2],
	"state"
> & { state: State };

type DelegateState = {
	state: Record<string, unknown>;
	call?: Component;
	result?: Component;
};
type RenderState = {
	root?: Container;
	delegates?: Map<string, DelegateState>;
};

function delegateState(
	context: RenderContext<RenderState>,
	id = context.toolCallId
): DelegateState {
	const delegates = (context.state.delegates ??= new Map());
	if (!delegates.has(id)) delegates.set(id, { state: {} });
	return delegates.get(id)!;
}

function heading(
	summary: Summary,
	theme: Theme,
	status?: "pending" | "success" | "soft" | "hard",
	member = false,
	last = false
): Text {
	const marker = member
		? last
			? "  └ "
			: "  ├ "
		: status === "hard"
		? "× "
		: status === "pending"
		? "◦ "
		: "• ";
	const bullet = theme.fg(
		status === "hard" ? "error" : status === "pending" ? "accent" : "muted",
		marker
	);
	const verb = member ? "" : `${theme.bold(summary.verb)} `;
	const target = theme.fg(
		status === "hard" ? "error" : "warning",
		summary.target
	);
	const detail = summary.detail
		? theme.fg("muted", ` (${summary.detail})`)
		: "";
	return new Text(`${bullet}${verb}${target}${detail}`, 0, 0);
}

function fallbackBody(
	result: AgentToolResult<unknown>,
	theme: Theme,
	expanded: boolean
): Component {
	const text = resultTextFromContent(result.content);
	const lines = expanded ? text : text.split("\n").slice(0, 10).join("\n");
	return new Text(theme.fg("toolOutput", lines), 0, 0);
}

/** One wrapper for every tool. No tool replacement, execution delegation, or model-facing mutation. */
export function createQuietRenderer(
	model: QuietModel,
	enabled: () => boolean
): ToolRendererResolver {
	const originals = new Map<string, ToolRenderers>();
	return (tool, next) => {
		const stock = next() ?? {};
		originals.set(tool, stock);
		return {
			renderShell: "self",
			renderCall(args, theme, context: RenderContext<RenderState>) {
				model.watch(context.toolCallId, context.invalidate);
				const root = (context.state.root ??= new Container());
				root.clear();
				if (!enabled()) {
					const state = delegateState(context);
					const inner =
						stock.renderCall?.(args, theme, {
							...context,
							state: state.state,
							lastComponent: state.call,
						}) ?? new Text(theme.bold(tool), 0, 0);
					state.call = inner;
					if (stock.renderShell === "self") root.addChild(inner);
					else {
						const bg = context.isPartial
							? "toolPendingBg"
							: context.isError
							? "toolErrorBg"
							: "toolSuccessBg";
						const shell = new Box(context.outputPad, 1, (line) =>
							theme.bg(bg, line)
						);
						shell.addChild(inner);
						root.addChild(shell);
					}
					return root;
				}
				if (model.isHidden(context.toolCallId)) return root;
				const members = model.members(context.toolCallId);
				if (members.length > 1)
					root.addChild(
						heading(
							groupSummary(groupKind(tool)!, members.length),
							theme,
							"success"
						)
					);
				else {
					const outcome = model.get(context.toolCallId)?.outcome;
					root.addChild(
						heading(
							summarize(
								tool,
								args as Record<string, unknown>,
								context.cwd,
								outcome
							),
							theme,
							outcome?.kind ?? "pending"
						)
					);
				}
				return root;
			},
			renderResult(
				result,
				options,
				theme,
				context: RenderContext<RenderState>
			) {
				const root = (context.state.root ??= new Container());
				if (!enabled()) {
					const state = delegateState(context);
					const inner =
						stock.renderResult?.(result, options, theme, {
							...context,
							state: state.state,
							lastComponent: state.result,
						}) ?? fallbackBody(result, theme, options.expanded);
					state.result = inner;
					const shell = root.children[0];
					if (stock.renderShell !== "self" && shell instanceof Box)
						shell.addChild(inner);
					else root.addChild(inner);
					return new Container();
				}
				if (model.isHidden(context.toolCallId)) return new Container();
				const members = model.members(context.toolCallId);
				root.clear();
				const args = (context.args ?? {}) as Record<string, unknown>;
				const outcome = classify(
					{ tool, args },
					result,
					context.isError,
					options.isPartial
				);
				if (members.length > 1) {
					root.addChild(
						heading(
							groupSummary(groupKind(tool)!, members.length),
							theme,
							"success"
						)
					);
					if (options.expanded) {
						for (const [i, member] of members.entries()) {
							root.addChild(
								heading(
									summarize(
										member.tool,
										member.args,
										context.cwd,
										member.outcome
									),
									theme,
									member.outcome?.kind,
									true,
									i === members.length - 1
								)
							);
							if (member.result)
								root.addChild(
									expandedBody(member, context, theme)
								);
						}
					} else {
						const shown = members.slice(-3);
						if (members.length > shown.length)
							root.addChild(
								new Text(
									theme.fg(
										"dim",
										`  │ … ${
											members.length - shown.length
										} earlier`
									),
									0,
									0
								)
							);
						for (const [i, member] of shown.entries())
							root.addChild(
								heading(
									summarize(
										member.tool,
										member.args,
										context.cwd,
										member.outcome
									),
									theme,
									member.outcome?.kind,
									true,
									i === shown.length - 1
								)
							);
					}
				} else {
					root.addChild(
						heading(
							summarize(tool, args, context.cwd, outcome),
							theme,
							outcome.kind
						)
					);
					if (options.expanded && !options.isPartial) {
						root.addChild(
							expandedBody(
								{
									id: context.toolCallId,
									tool,
									args,
									result,
									isError: context.isError,
								},
								context,
								theme
							)
						);
					} else if (outcome.kind === "hard" && outcome.body) {
						root.addChild(
							new Text(
								theme.fg("error", failureTail(outcome.body)),
								2,
								0
							)
						);
					}
				}
				return new Container();
			},
		};
	};

	function expandedBody(
		row: Row,
		context: RenderContext<RenderState>,
		theme: Theme
	): Component {
		const state = delegateState(context, row.id);
		const original = originals.get(row.tool);
		const memberContext = {
			...context,
			toolCallId: row.id,
			args: row.args,
			isError: Boolean(row.isError),
			isPartial: false,
			expanded: true,
			state: state.state,
			lastComponent: state.result,
		};
		try {
			const call = original?.renderCall?.(row.args, theme, {
				...memberContext,
				lastComponent: state.call,
			});
			state.call = call;
			const body =
				original?.renderResult?.(
					row.result!,
					{ expanded: true, isPartial: false },
					theme,
					memberContext
				) ?? fallbackBody(row.result!, theme, true);
			state.result = body;
			if (original?.renderShell === "self" && call) {
				const full = new Container();
				full.addChild(call);
				full.addChild(body);
				return full;
			}
			return body;
		} catch {
			return fallbackBody(row.result!, theme, true);
		}
	}
}
