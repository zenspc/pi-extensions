import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createFooterActivity } from "./activity.ts";
import {
	emptyFooterUsageTotals,
	resolveFooterThinkingLevel,
	sumRecordedUsage,
	thinkingLevelColorToken,
} from "../custom-footer-helpers.mjs";

export type FooterFactory = NonNullable<
	Parameters<ExtensionContext["ui"]["setFooter"]>[0]
>;

export function createCustomFooter(
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
		let usageTotals = emptyFooterUsageTotals();
		let usageEntryCount = -1;
		const dispose = () => {
			activity.dispose();
			unsubThinking();
			unsubBranch();
		};

		return {
			dispose,
			invalidate() {},
			render(width: number): string[] {
				// Entries are append-only. Read persisted sources so standalone usage and
				// summaries are included, without double counting live nested-tool events.
				const entries = ctx.sessionManager.getEntries();
				if (entries.length !== usageEntryCount) {
					usageTotals = sumRecordedUsage(entries);
					usageEntryCount = entries.length;
				}
				const { input, output, cost, reasoning } = usageTotals;

				const fmt = (n: number) => {
					if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
					if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
					return `${n}`;
				};

				// Separator
				const sep = " " + theme.fg("dim", "│") + " ";

				// Session context usage - model's context window
				const contextUsage = ctx.getContextUsage();
				const ctxLimit =
					contextUsage?.contextWindow ??
					ctx.model?.contextWindow ??
					0;
				const ctxTokens = contextUsage?.tokens ?? 0;
				let contextStr = "";
				if (ctxLimit > 0) {
					const pct = (ctxTokens / ctxLimit) * 100;
					const color =
						pct > 80 ? "error" : pct > 50 ? "warning" : "success";
					contextStr =
						theme.fg(color, fmt(ctxTokens)) +
						theme.fg("dim", "/" + fmt(ctxLimit));
				}

				const gitBranch = footerData.getGitBranch();

				// Colored stat labels - using valid theme token names only
				const arrowUp =
					theme.fg("success", "↑") + theme.fg("text", fmt(input));
				const arrowDown =
					theme.fg("error", "↓") + theme.fg("text", fmt(output));
				const reasoningStr =
					reasoning > 0
						? theme.fg("accent", "R") +
						  theme.fg("text", fmt(reasoning))
						: "";
				const costStr = theme.fg("warning", "$" + cost.toFixed(3));
				const speedStr =
					activity.speed !== null
						? theme.fg("mdLink", fmt(activity.speed) + " t/s")
						: "";

				const idleStr = activity.renderTimer(theme);

				// Live session thinking level (never hard-code a default - no startup event).
				const thinkingLevel = resolveFooterThinkingLevel(() =>
					pi.getThinkingLevel()
				);
				const levelColor = thinkingLevelColorToken(thinkingLevel);
				const levelDot = theme.fg(levelColor, "●");
				const modelStr = theme.fg(
					"accent",
					ctx.model?.id || "no-model"
				);
				const levelStr = theme.fg("muted", thinkingLevel);

				// Git branch - use success color
				const gitStr = gitBranch
					? theme.fg("toolDiffAdded", " " + gitBranch)
					: "";

				// ===== LEFT: stats with │ separators between each =====
				const leftParts = [
					arrowUp,
					arrowDown,
					reasoningStr,
					costStr,
					contextStr,
					speedStr,
					idleStr,
				].filter(Boolean);

				const left = leftParts.join(sep);

				// ===== RIGHT: model info =====
				const rightParts = [
					modelStr,
					levelDot + " " + levelStr,
					gitStr,
				].filter(Boolean);

				const right = rightParts.join(" " + theme.fg("dim", "•") + " ");
				const midSep = right ? " " + theme.fg("dim", "│") + " " : "";

				// Pad left side so right side is right-aligned
				const leftContent = left + midSep;
				const padNeeded = Math.max(
					1,
					width - visibleWidth(leftContent) - visibleWidth(right)
				);
				const pad = " ".repeat(padNeeded);

				return [truncateToWidth(leftContent + pad + right, width)];
			},
		};
	};
}
