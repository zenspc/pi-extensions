/**
 * /ctx - shows what fills the context window: fixed overhead (system prompt, tool
 * declarations, skills, context files) per package, and the conversation per tool and block.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { plainPalette, renderReport } from "./render.ts";
import { buildReport } from "./report.ts";
import { collectSnapshot } from "./snapshot.ts";
import { showReport } from "./viewer.ts";

const PLAIN_TEXT_WIDTH = 110;

export default function contextAudit(pi: ExtensionAPI) {
	pi.registerCommand("ctx", {
		description: "Audit what is using the context window: setup cost by package, tools, skills, conversation",
		handler: async (_args, ctx) => {
			const report = buildReport(collectSnapshot(pi, ctx));
			if (ctx.mode === "tui") await showReport(ctx, report);
			else ctx.ui.notify(renderReport(report, plainPalette, PLAIN_TEXT_WIDTH).join("\n"), "info");
		},
	});
}
