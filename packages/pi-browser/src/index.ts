import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createAttachment } from "./attachment.ts";
import { browserTool } from "./browser-tool.ts";
import { installDomainGate } from "./gate.ts";
import { refLocator, takeSnapshot } from "./snapshot.ts";

const defaultAttachment = createAttachment();

function serializeEvaluateResult(result: unknown): string {
	if (result === undefined) return "undefined";
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

export default function (
	pi: ExtensionAPI,
	options?: { attachment?: typeof defaultAttachment },
) {
	const attachment = options?.attachment ?? defaultAttachment;

	function currentUrl(): Promise<string> {
		return attachment.withTab(async (tab) => tab.url());
	}

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
	browserTool(pi, {
		name: "browser_snapshot",
		label: "Browser Snapshot",
		description:
			"Render the Automation Tab as a compact accessibility tree. Every interactive element carries an Element Ref like [ref=e12]. Use a Ref with browser_click or browser_type; take a new Snapshot after navigation.",
		parameters: Type.Object({}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId) {
			const result = await attachment.withTab((tab) => takeSnapshot(tab));
			return {
				content: [
					{
						type: "text",
						text: `${result.title}\n${result.url}\n\n${result.text}`,
					},
				],
				details: result,
			};
		},
	});
	browserTool(pi, {
		name: "browser_click",
		label: "Browser Click",
		description:
			'Click the element referenced by an Element Ref from browser_snapshot, like "e12". Throws if the Ref is stale or unknown; take a new browser_snapshot.',
		parameters: Type.Object({
			ref: Type.String({ description: 'Element Ref from browser_snapshot, like "e12"' }),
		}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId, params) {
			await attachment.withTab(async (tab) => {
				const locator = await refLocator(tab, params.ref);
				await locator.click();
			});
			return {
				content: [{ type: "text", text: `Clicked [ref=${params.ref}]` }],
				details: { ref: params.ref },
			};
		},
	});
	browserTool(pi, {
		name: "browser_type",
		label: "Browser Type",
		description:
			'Enter text into the field referenced by an Element Ref from browser_snapshot, like "e7". Throws if the Ref is stale or unknown; take a new browser_snapshot.',
		parameters: Type.Object({
			ref: Type.String({ description: 'Element Ref from browser_snapshot, like "e7"' }),
			text: Type.String({ description: "Text to enter into the field" }),
		}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId, params) {
			await attachment.withTab(async (tab) => {
				const locator = await refLocator(tab, params.ref);
				await locator.fill(params.text);
			});
			return {
				content: [{ type: "text", text: `Filled [ref=${params.ref}]` }],
				details: { ref: params.ref, length: params.text.length },
			};
		},
	});
	browserTool(pi, {
		name: "browser_screenshot",
		label: "Browser Screenshot",
		description:
			"Capture a full-viewport PNG screenshot of the Automation Tab. Returns the image plus its pixel dimensions.",
		parameters: Type.Object({}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId) {
			const result = await attachment.withTab(async (tab) => {
				const buffer = await tab.screenshot({ type: "png" });
				return {
					buffer,
					width: buffer.readUInt32BE(16),
					height: buffer.readUInt32BE(20),
				};
			});
			return {
				content: [
					{
						type: "text",
						text: `Screenshot captured (${result.width}x${result.height} px)`,
					},
					{
						type: "image",
						data: result.buffer.toString("base64"),
						mimeType: "image/png",
					},
				],
				details: { width: result.width, height: result.height },
			};
		},
	});
	browserTool(pi, {
		name: "browser_evaluate",
		label: "Browser Evaluate",
		description:
			"Evaluate a JavaScript expression in the Automation Tab's page context and return the serialized result. Throws with the page error text when evaluation fails.",
		parameters: Type.Object({
			expression: Type.String({
				description: "JavaScript expression to evaluate in the page context and return",
			}),
		}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId, params) {
			let result: unknown;
			try {
				result = await attachment.withTab((tab) => tab.evaluate(params.expression));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`browser_evaluate failed: ${message}`);
			}
			return {
				content: [{ type: "text", text: serializeEvaluateResult(result) }],
				details: { expression: params.expression, result },
			};
		},
	});
}
