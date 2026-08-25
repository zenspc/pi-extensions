import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createAttachment } from "./attachment.ts";
import { browserTool } from "./browser-tool.ts";
import { installDomainGate } from "./gate.ts";

const attachment = createAttachment();

export default function (pi: ExtensionAPI) {
	installDomainGate(pi);
	browserTool(pi, {
		name: "browser_navigate",
		label: "Browser Navigate",
		description:
			"Navigate the Automation Tab to a URL and report the resulting page title. Attaches over CDP to the user's running Chrome; fails with the exact relaunch command if Chrome lacks its remote debugging port.",
		parameters: Type.Object({
			url: Type.String({
				description: "Absolute URL to navigate to",
			}),
		}),
		async execute(_toolCallId, params) {
			const result = await attachment.withTab(async (tab) => {
				await tab.goto(params.url, { waitUntil: "load" });
				return { url: tab.url(), title: await tab.title() };
			});
			return {
				content: [
					{ type: "text", text: `${result.title}\n${result.url}` },
				],
				details: result,
			};
		},
	});
}
