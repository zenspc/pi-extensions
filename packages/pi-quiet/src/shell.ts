/**
 * Tool Shell Background tokens (Stock-matching strip under renderShell: "self").
 */

import type { QuietOutcome } from "./classify.ts";

/** Match Pi ToolExecutionComponent default Box padding. */
export const TOOL_SHELL_PADDING = 1;

export type ToolShellBg = "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

/** Quiet outcome → Tool Shell Background token (Soft shares success). */
export function toolShellBgForQuietOutcome(kind: QuietOutcome["kind"]): ToolShellBg {
	switch (kind) {
		case "pending":
			return "toolPendingBg";
		case "hard":
			return "toolErrorBg";
		case "soft":
		case "success":
			return "toolSuccessBg";
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}

/** Stock path: same rules as ToolExecutionComponent bgFn. */
export function toolShellBgForStock(isPartial: boolean, isError: boolean): ToolShellBg {
	if (isPartial) return "toolPendingBg";
	if (isError) return "toolErrorBg";
	return "toolSuccessBg";
}
