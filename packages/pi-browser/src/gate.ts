import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { addToAllowlist, getAllowlistPath, loadAllowlist } from "./allowlist.ts";
import { registrableDomain } from "./domains.ts";

export type Verdict = "pass" | "ask";

export type PromptOutcome = "once" | "permanent" | "deny";

export type UrlExtractor = (input: Record<string, unknown>) => string | Promise<string>;

export type DomainGateOptions = {
	allowlistPath?: string;
};

const PROMPT_CHOICES = ["Approve once", "Approve permanently", "Deny"];

const urlExtractors = new Map<string, UrlExtractor>();

export function registerExtractor(name: string, extract: UrlExtractor): void {
	urlExtractors.set(name, extract);
}

export function decide(domain: string, allowed: Set<string>): Verdict {
	return allowed.has(domain) ? "pass" : "ask";
}

export function promptOutcome(choice: string | undefined): PromptOutcome {
	if (choice === "Approve permanently") return "permanent";
	if (choice === "Approve once") return "once";
	return "deny";
}

export function installDomainGate(pi: ExtensionAPI, options?: DomainGateOptions): void {
	const allowlistPath = options?.allowlistPath ?? getAllowlistPath();
	const sessionAllowed = new Set<string>();
	let allowlistLoaded = false;

	function ensureAllowlistLoaded(): void {
		if (allowlistLoaded) return;
		allowlistLoaded = true;
		for (const domain of loadAllowlist(allowlistPath)) sessionAllowed.add(domain);
	}

	function block(reason: string): ToolCallEventResult {
		return { block: true, reason };
	}

	async function gateCall(
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> {
		const extract = urlExtractors.get(event.toolName);
		if (!extract) return undefined;

		const rawUrl = await extract(event.input as unknown as Record<string, unknown>);
		let url: URL;
		try {
			url = new URL(rawUrl);
		} catch {
			return block(`pi-browser blocked "${event.toolName}": "${rawUrl}" is not a valid URL.`);
		}

		const domain = registrableDomain(url.hostname);
		ensureAllowlistLoaded();
		if (decide(domain, sessionAllowed) === "pass") return undefined;

		if (!ctx.hasUI) {
			return block(
				`pi-browser blocked ${domain}: no UI is available to approve it. Add "${domain}" to ${allowlistPath} and retry.`,
			);
		}

		const outcome = promptOutcome(await ctx.ui.select(`Allow access to ${domain}?`, PROMPT_CHOICES));
		if (outcome === "deny") {
			return block(`User denied browser access to ${domain}.`);
		}
		if (outcome === "permanent") addToAllowlist(domain, allowlistPath);
		sessionAllowed.add(domain);
		return undefined;
	}

	pi.on("tool_call", async (event, ctx) => {
		try {
			return await gateCall(event, ctx);
		} catch (error) {
			return block(
				`pi-browser domain gate failed for "${event.toolName}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	});
}
