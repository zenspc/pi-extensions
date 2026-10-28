import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { addToAllowlist, getAllowlistPath, loadAllowlist } from "./allowlist.ts";
import { classifyUrl } from "./domains.ts";

export type Verdict = "pass" | "ask" | "deny";

export type PromptOutcome = "once" | "permanent" | "deny";

export type UrlExtractor = (
	input: Record<string, unknown>,
	signal?: AbortSignal
) => string | Promise<string>;

export type DomainGateOptions = {
	allowlistPath?: string;
};

const PROMPT_CHOICES = ["Approve once", "Approve permanently", "Deny"];

const extractors = new WeakMap<ExtensionAPI, Map<string, UrlExtractor>>();

export function registerExtractor(pi: ExtensionAPI, name: string, extract: UrlExtractor): void {
	let registered = extractors.get(pi);
	if (!registered) extractors.set(pi, (registered = new Map()));
	registered.set(name, extract);
}

export function decide(domain: string, allowed: Set<string>, denied: Set<string>): Verdict {
	if (allowed.has(domain)) return "pass";
	if (denied.has(domain)) return "deny";
	return "ask";
}

export function promptOutcome(choice: string | undefined): PromptOutcome {
	if (choice === "Approve permanently") return "permanent";
	if (choice === "Approve once") return "once";
	return "deny";
}

export function installDomainGate(
	pi: ExtensionAPI,
	options?: DomainGateOptions
): { allowed: Set<string> } {
	const allowlistPath = options?.allowlistPath ?? getAllowlistPath();
	const sessionAllowed = loadAllowlist(allowlistPath);
	const sessionDenied = new Set<string>();

	function block(reason: string): ToolCallEventResult {
		return { block: true, reason };
	}

	async function gateCall(
		event: ToolCallEvent,
		ctx: ExtensionContext
	): Promise<ToolCallEventResult | undefined> {
		const extract = extractors.get(pi)?.get(event.toolName);
		if (!extract) return undefined;

		const rawUrl = await extract(event.input as unknown as Record<string, unknown>, ctx.signal);
		let url: URL;
		try {
			url = new URL(rawUrl);
		} catch {
			return block(`pi-browser blocked "${event.toolName}": "${rawUrl}" is not a valid URL.`);
		}

		const classified = classifyUrl(url);
		if (classified.kind === "blank") return undefined;
		if (classified.kind === "blocked") {
			return block(
				`pi-browser blocked "${event.toolName}": "${rawUrl}" is not an allowed site.`
			);
		}
		const domain = classified.domain;
		const verdict = decide(domain, sessionAllowed, sessionDenied);
		if (verdict === "pass") return undefined;
		if (verdict === "deny") {
			return block(`User denied browser access to ${domain}.`);
		}

		if (!ctx.hasUI) {
			return block(
				`pi-browser blocked ${domain}: no UI is available to approve it. Add "${domain}" to ${allowlistPath} and retry.`
			);
		}

		const outcome = promptOutcome(
			await ctx.ui.select(`Allow access to ${domain}?`, PROMPT_CHOICES, {
				signal: ctx.signal,
			})
		);
		ctx.signal?.throwIfAborted();
		if (outcome === "deny") {
			sessionDenied.add(domain);
			return block(`User denied browser access to ${domain}.`);
		}
		if (outcome === "permanent") addToAllowlist(domain, allowlistPath);
		sessionAllowed.add(domain);
		return undefined;
	}

	let pending: Promise<unknown> = Promise.resolve();
	pi.on("tool_call", (event, ctx) => {
		if (!extractors.get(pi)?.has(event.toolName)) return Promise.resolve(undefined);
		const call = pending.then(async () => {
			try {
				ctx.signal?.throwIfAborted();
				return await gateCall(event, ctx);
			} catch (error) {
				return block(
					`pi-browser domain gate failed for "${event.toolName}": ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		});
		pending = call.catch(() => undefined);
		return call;
	});

	return { allowed: sessionAllowed };
}
