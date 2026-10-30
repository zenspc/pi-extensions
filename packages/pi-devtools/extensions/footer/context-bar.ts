import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sumRecordedUsage } from "../custom-footer-helpers.mjs";
import type { FooterFactory } from "./custom.ts";
import { createFooterActivity } from "./activity.ts";

const BAR_WIDTH = 20;
const MIN_BAR_WIDTH = 5;

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export function createContextBar(
	pi: ExtensionAPI,
	ctx: ExtensionContext
): FooterFactory {
	return (tui, theme, footerData) => {
		const activity = createFooterActivity(pi, ctx, () =>
			tui.requestRender()
		);
		const unsubThinking = pi.on("thinking_level_select", async () =>
			tui.requestRender()
		);
		const unsubBranch = footerData.onBranchChange(() =>
			tui.requestRender()
		);
		let entryCount = -1;
		let cost = 0;
		return {
			dispose() {
				activity.dispose();
				unsubThinking();
				unsubBranch();
			},
			invalidate() {},
			render(width: number): string[] {
				const entries = ctx.sessionManager.getEntries();
				if (entries.length !== entryCount) {
					cost = sumRecordedUsage(entries).cost;
					entryCount = entries.length;
				}
				const contextUsage = ctx.getContextUsage();
				const used = contextUsage?.tokens ?? 0;
				const contextWindow =
					contextUsage?.contextWindow ??
					ctx.model?.contextWindow ??
					0;
				const pctUsed = Math.min(
					100,
					Math.max(
						0,
						contextUsage?.percent ??
							(contextWindow > 0
								? (used / contextWindow) * 100
								: 0)
					)
				);
				const barColor =
					pctUsed >= 80
						? "error"
						: pctUsed >= 50
						? "warning"
						: "success";
				const bar = (size: number) => {
					const filled = Math.round((pctUsed / 100) * size);
					return (
						theme.fg(barColor, "█".repeat(filled)) +
						theme.fg("dim", "░".repeat(size - filled))
					);
				};
				const branch = footerData.getGitBranch();
				const branchSeg = theme.fg(
					"mdLink",
					branch ? `⎇ ${branch}` : "no git"
				);
				const thinking = ctx.model?.reasoning
					? theme.fg("muted", ` · ${pi.getThinkingLevel()}`)
					: "";
				const modelSeg =
					theme.fg(
						"accent",
						`${ctx.model?.provider ?? "?"}/${
							ctx.model?.id ?? "none"
						}`
					) + thinking;
				const contextSeg = (barSize: number) =>
					theme.fg("muted", "Context: [") +
					bar(barSize) +
					theme.fg("muted", "] ") +
					theme.fg(
						"mdCode",
						`${fmtTokens(used)}/${fmtTokens(contextWindow)}`
					) +
					theme.fg(barColor, ` (${pctUsed.toFixed(0)}%)`);
				const free =
					!ctx.model?.cost?.input && !ctx.model?.cost?.output;
				const costSeg =
					free && cost === 0
						? undefined
						: theme.fg("success", `$${cost.toFixed(3)}`);
				const sep = theme.fg("dim", " │ ");
				const line = (barSize: number) =>
					[
						modelSeg,
						branchSeg,
						contextSeg(barSize),
						costSeg,
						activity.renderTimer(theme),
					]
						.filter(Boolean)
						.join(sep);
				const overflow = visibleWidth(line(BAR_WIDTH)) - width;
				const barSize = Math.max(
					MIN_BAR_WIDTH,
					BAR_WIDTH - Math.max(0, overflow)
				);
				return [truncateToWidth(line(barSize), width)];
			},
		};
	};
}
