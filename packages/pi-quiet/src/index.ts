/**
 * @zenspc/pi-quiet - Quiet Display for pi built-in tools.
 *
 * Default once installed: Quiet Display (dense one-line tool rows).
 * Sticky Preference: ~/.pi/agent/extensions/quiet.json
 *
 * Commands:
 *   /quiet           Toggle Quiet Display
 *   /quiet on|off    Set Sticky Preference
 *   /quiet status    Show preference + config path
 *   /quiet help
 *
 * Scope (v1): read, bash, edit, write, find, grep, ls.
 * Assistant prose, thinking, MCP/extension tools: unchanged.
 * Toggle is forward-only (scrollback not rewritten).
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	applyQuietCommand,
	formatQuietHelp,
	formatQuietStatus,
	parseQuietCommand,
} from "./command.ts";
import { getConfigPath, loadQuietConfig, saveQuietConfig } from "./config.ts";
import { registerQuietTools } from "./tools.ts";

function notify(
	ctx: ExtensionCommandContext | ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function quietExtension(pi: ExtensionAPI) {
	let enabled = loadQuietConfig().enabled;
	const configPath = getConfigPath();

	registerQuietTools(pi, () => enabled);

	pi.on("session_start", async () => {
		// Re-read Sticky Preference at session start (forward-only within a session).
		enabled = loadQuietConfig().enabled;
	});

	pi.registerCommand("quiet", {
		description: "Toggle Quiet Display for built-in tool rows",
		handler: async (args, ctx) => {
			const cmd = parseQuietCommand(args);
			const result = applyQuietCommand(cmd, enabled);

			if (result.kind === "help") {
				notify(ctx, formatQuietHelp(configPath), cmd.action === "unknown" ? "warning" : "info");
				return;
			}

			if (result.kind === "status") {
				notify(ctx, formatQuietStatus(enabled, configPath));
				return;
			}

			// kind === "set"
			if (result.changed) {
				if (!saveQuietConfig({ enabled: result.enabled })) {
					notify(ctx, `Failed to save Sticky Preference to ${configPath}`, "error");
					return;
				}
				enabled = result.enabled;
			}

			notify(ctx, formatQuietStatus(enabled, configPath));
		},
	});
}
