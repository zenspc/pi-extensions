import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { SidePanel } from "./panel.ts";
import { SideThread } from "./thread.ts";

export default function btw(pi: ExtensionAPI) {
	const thread = new SideThread();
	let panel: SidePanel | undefined;
	let closePanel: (() => void) | undefined;
	thread.onChange = () => panel?.refresh();

	pi.on("session_shutdown", () => {
		thread.clear();
		closePanel?.();
	});

	async function open(ctx: ExtensionCommandContext) {
		if (closePanel) return;
		try {
			await ctx.ui.custom<void>((tui, theme, keys, done) => {
				closePanel = () => done();
				panel = new SidePanel({
					thread,
					tui,
					theme,
					keys,
					ask: (question) => thread.ask(question, ctx),
					done: () => done(),
				});
				return panel;
			});
		} finally {
			panel = undefined;
			closePanel = undefined;
		}
	}

	const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description:
			"Ask a tool-free side question without interrupting the agent; /btw or /side reopens temporary history",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires interactive Pi.", "warning");
				return;
			}
			const question = args.trim();
			if (question && thread.running) {
				ctx.ui.notify(
					"A side question is still answering. Reopening it; ask your next question after it finishes.",
					"info"
				);
			} else if (question) {
				try {
					// Deliberately not awaited: the main agent and side panel have independent lifetimes.
					void thread.ask(question, ctx);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error"
					);
					return;
				}
			}
			await open(ctx);
		},
	};
	pi.registerCommand("btw", command);
	pi.registerCommand("side", command);
}
