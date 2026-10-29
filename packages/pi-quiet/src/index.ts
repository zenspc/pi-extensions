import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	applyQuietCommand,
	formatQuietHelp,
	formatQuietStatus,
	parseQuietCommand,
} from "./command.ts";
import { getConfigPath, loadQuietConfig, saveQuietConfig } from "./config.ts";
import { QuietChrome } from "./chrome.ts";
import { hasProse, QuietModel } from "./model.ts";
import { createQuietRenderer } from "./render.ts";

export default function quietExtension(pi: ExtensionAPI): void {
	let enabled = loadQuietConfig().enabled;
	const model = new QuietModel();
	const chrome = new QuietChrome(pi);
	pi.registerToolRenderer(createQuietRenderer(model, () => enabled));

	const rebuild = (ctx: ExtensionContext) => {
		model.rebuild(
			ctx.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "message")
				.map((entry) => entry.message)
		);
	};
	pi.on("session_start", (_event, ctx) => {
		enabled = loadQuietConfig().enabled;
		rebuild(ctx);
		if (enabled) chrome.install(ctx);
		else chrome.restore();
	});
	pi.on("session_tree", (_event, ctx) => {
		rebuild(ctx);
		chrome.refresh();
	});
	pi.on("session_compact", (_event, ctx) => {
		rebuild(ctx);
		chrome.refresh();
	});
	pi.on("session_shutdown", () => {
		chrome.restore();
		model.clear();
	});
	pi.on("message_start", (event) => {
		if (event.message.role === "user") model.boundary();
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant" && hasProse(event.message))
			model.boundary();
		chrome.refresh();
	});
	pi.on("tool_execution_start", (event) => {
		if (!event.parentToolCallId)
			model.start(
				event.toolCallId,
				event.toolName,
				event.args as Record<string, unknown>
			);
	});
	pi.on("tool_execution_end", (event) => {
		if (!event.parentToolCallId)
			model.end(
				event.toolCallId,
				event.toolName,
				event.result,
				event.isError
			);
	});
	pi.on("agent_start", () => chrome.refresh());
	pi.on("agent_settled", () => chrome.refresh());
	pi.on("model_select", () => chrome.refresh());
	pi.on("thinking_level_select", () => chrome.refresh());

	pi.registerCommand("quiet", {
		description: "Toggle Grok Build-inspired terminal presentation",
		handler: async (args, ctx) => {
			const command = parseQuietCommand(args);
			const result = applyQuietCommand(command, enabled);
			if (result.kind === "help") {
				if (ctx.hasUI)
					ctx.ui.notify(
						formatQuietHelp(getConfigPath()),
						command.action === "unknown" ? "warning" : "info"
					);
				return;
			}
			if (result.kind === "set" && result.changed) {
				if (!saveQuietConfig({ enabled: result.enabled })) {
					if (ctx.hasUI)
						ctx.ui.notify(
							`Could not save Quiet preference to ${getConfigPath()}`,
							"error"
						);
					return;
				}
				enabled = result.enabled;
				if (enabled) chrome.install(ctx);
				else chrome.restore();
				model.invalidate();
			}
			if (ctx.hasUI)
				ctx.ui.notify(
					formatQuietStatus(enabled, getConfigPath()),
					"info"
				);
		},
	});
}
