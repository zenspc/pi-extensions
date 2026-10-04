import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright-core";
import { Type, type TSchema } from "typebox";
import { createAttachment } from "./attachment.ts";
import {
	applyToolAvailability,
	getAvailabilityPath,
	loadToolAvailability,
	saveToolAvailability,
} from "./availability.ts";
import { browserTool, type BrowserToolDef } from "./browser-tool.ts";
import {
	applyBrowserCommand,
	formatBrowserHelp,
	formatBrowserStatus,
	parseBrowserCommand,
} from "./command.ts";
import { installDomainGate } from "./gate.ts";
import { createNavigationGuard } from "./navigation.ts";
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

function notify(
	ctx: ExtensionCommandContext | ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function (
	pi: ExtensionAPI,
	options?: {
		attachment?: typeof defaultAttachment;
		allowlistPath?: string;
		availabilityPath?: string;
	},
) {
	const attachment = options?.attachment ?? defaultAttachment;
	const availabilityPath = options?.availabilityPath ?? getAvailabilityPath();
	let available = loadToolAvailability(availabilityPath).available;
	const browserTools: string[] = [];
	const { allowed } = installDomainGate(pi, { allowlistPath: options?.allowlistPath });
	const nav = createNavigationGuard(allowed);

	function register<TParams extends TSchema, TDetails = unknown>(
		def: BrowserToolDef<TParams, TDetails>,
	): void {
		browserTools.push(def.name);
		browserTool(pi, def);
	}

	async function withAutomationTab<T>(fn: (tab: Page) => Promise<T>): Promise<T> {
		return attachment.withTab(async (tab) => {
			await nav.ensureInstalled(tab);
			return fn(tab);
		});
	}

	function currentUrl(): Promise<string> {
		return withAutomationTab(async (tab) => tab.url());
	}

	async function runTool<T>(fn: (tab: Page) => Promise<T>): Promise<T> {
		return withAutomationTab(async (tab) => {
			nav.begin(tab.url());
			try {
				const result = await fn(tab);
				await nav.finish(tab);
				return result;
			} catch (error) {
				await nav.finish(tab);
				throw error;
			}
		});
	}
	register({
		name: "browser_navigate",
		label: "Browser Navigate",
		description:
			"Navigate the Automation Tab to a URL and report the resulting page title. Launches the dedicated Chrome on first use.",
		parameters: Type.Object({
			url: Type.String({
				description: "Absolute URL to navigate to",
			}),
		}),
		async execute(_toolCallId, params) {
			const result = await runTool(async (tab) => {
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
	register({
		name: "browser_snapshot",
		label: "Browser Snapshot",
		description:
			"Render the Automation Tab as a compact accessibility tree. Every interactive element carries an Element Ref like [ref=e12]. Use a Ref with browser_click or browser_type; take a new Snapshot after navigation.",
		parameters: Type.Object({}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId) {
			const result = await runTool((tab) => takeSnapshot(tab));
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
	register({
		name: "browser_click",
		label: "Browser Click",
		description:
			'Click the element referenced by an Element Ref from browser_snapshot, like "e12". Throws if the Ref is stale or unknown; take a new browser_snapshot.',
		parameters: Type.Object({
			ref: Type.String({ description: 'Element Ref from browser_snapshot, like "e12"' }),
		}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId, params) {
			await runTool(async (tab) => {
				const locator = await refLocator(tab, params.ref);
				await locator.click();
			});
			return {
				content: [{ type: "text", text: `Clicked [ref=${params.ref}]` }],
				details: { ref: params.ref },
			};
		},
	});
	register({
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
			await runTool(async (tab) => {
				const locator = await refLocator(tab, params.ref);
				await locator.fill(params.text);
			});
			return {
				content: [{ type: "text", text: `Filled [ref=${params.ref}]` }],
				details: { ref: params.ref, length: params.text.length },
			};
		},
	});
	register({
		name: "browser_screenshot",
		label: "Browser Screenshot",
		description:
			"Capture a full-viewport PNG screenshot of the Automation Tab. Returns the image plus its pixel dimensions.",
		parameters: Type.Object({}),
		urlFrom: () => currentUrl(),
		async execute(_toolCallId) {
			const result = await runTool(async (tab) => {
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
	register({
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
			const result = await runTool(async (tab) => {
				try {
					return await tab.evaluate(params.expression);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`browser_evaluate failed: ${message}`);
				}
			});
			return {
				content: [{ type: "text", text: serializeEvaluateResult(result) }],
				details: { expression: params.expression, result },
			};
		},
	});

	pi.on("session_start", async () => {
		available = loadToolAvailability(availabilityPath).available;
		applyToolAvailability(pi, available, browserTools);
	});

	pi.registerCommand("browser", {
		description: "Show or switch Tool Availability for Browser Tools",
		handler: async (args, ctx) => {
			const cmd = parseBrowserCommand(args);
			const result = applyBrowserCommand(cmd, available);

			if (result.kind === "help") {
				notify(ctx, formatBrowserHelp(), cmd.action === "unknown" ? "warning" : "info");
				return;
			}

			if (result.kind === "status") {
				notify(ctx, formatBrowserStatus(available));
				return;
			}

			if (result.changed) {
				if (!saveToolAvailability({ available: result.available }, availabilityPath)) {
					notify(ctx, `Failed to save Tool Availability to ${availabilityPath}`, "error");
					return;
				}
				available = result.available;
				applyToolAvailability(pi, available, browserTools);
			}

			notify(ctx, formatBrowserStatus(available));
		},
	});
}
