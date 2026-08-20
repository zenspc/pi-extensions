/**
 * pi-copilot-discovery — live GitHub Copilot catalog for pi.
 *
 * Registers a native provider wrap of the builtin `github-copilot` provider:
 *   - builtin auth + streams stay in place
 *   - getModels() serves the live `/models` catalog
 *   - filterModels is cleared so tenant-private / preview ids are kept
 *
 * Token refresh/persistence remains owned by pi's OAuth/auth-storage path.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Model } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import {
	type ContextMode,
	loadContextMode,
	parseContextModeArg,
	saveContextMode,
} from "./context-mode.ts";
import { fetchCopilotModels, resolveCopilotBaseUrl, toProviderModels } from "./models.ts";
import { enableUnconfiguredPolicies } from "./policies.ts";
import { loadPricingTable } from "./pricing.ts";

const PROVIDER_NAME = "github-copilot";

type StoredCredentials = {
	access: string;
	enterpriseUrl?: string;
};

type RefreshResult = { ok: true; count: number } | { ok: false; error: string };

// Same logic as pi-coding-agent's `getAgentDir()` so we read the same
// auth.json pi writes (including PI_CODING_AGENT_DIR overrides).
function getAuthPath(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	const base = envDir
		? envDir.replace(/^~(\/|$)/, `${homedir()}$1`)
		: join(homedir(), ".pi", "agent");
	return join(base, "auth.json");
}

function enterpriseUrlFrom(creds: { enterpriseUrl?: unknown } | null | undefined): string | undefined {
	return typeof creds?.enterpriseUrl === "string" && creds.enterpriseUrl.length > 0
		? creds.enterpriseUrl
		: undefined;
}

function parseStoredCredential(entry: unknown): StoredCredentials | null {
	if (!entry || typeof entry !== "object") return null;
	const rec = entry as { access?: unknown; enterpriseUrl?: unknown };
	if (typeof rec.access !== "string" || rec.access.length === 0) return null;
	const out: StoredCredentials = { access: rec.access };
	const enterpriseUrl = enterpriseUrlFrom(rec);
	if (enterpriseUrl) out.enterpriseUrl = enterpriseUrl;
	return out;
}

async function readStoredCredentials(): Promise<StoredCredentials | null> {
	try {
		const buf = await readFile(getAuthPath(), "utf8");
		if (buf.length > 1_000_000) {
			console.error("pi-copilot-discovery: auth.json is unexpectedly large; ignoring");
			return null;
		}
		const json = JSON.parse(buf) as Record<string, unknown>;
		return parseStoredCredential(json[PROVIDER_NAME]);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error(
				`pi-copilot-discovery: could not read auth.json (${err instanceof Error ? err.message : String(err)})`,
			);
		}
	}
	return null;
}

function toRuntimeModels(configs: ProviderConfig["models"], baseUrl: string): Model[] {
	return (configs ?? []).map((m) => ({
		...m,
		provider: PROVIDER_NAME,
		baseUrl: m.baseUrl ?? baseUrl,
		headers: undefined,
	})) as Model[];
}

export default async function (pi: ExtensionAPI): Promise<void> {
	const builtin = githubCopilotProvider();
	let liveModels: readonly Model[] = builtin.getModels();
	let contextMode: ContextMode = await loadContextMode();

	const provider = {
		...builtin,
		filterModels: undefined,
		getModels: () => liveModels,
		refreshModels: async (context) => {
			if (!context.allowNetwork) return;
			const creds = context.credential;
			if (!creds || creds.type !== "oauth" || typeof creds.access !== "string") return;
			const enterpriseUrl = enterpriseUrlFrom(creds);
			const raw = await fetchCopilotModels(creds.access, enterpriseUrl, context.signal);
			const next = toProviderModels(raw, await loadPricingTable(), { contextMode });
			if (next.length === 0) return;
			const runtime = toRuntimeModels(next, resolveCopilotBaseUrl(creds.access, enterpriseUrl));
			if (
				!(await context.publish({
					update: () => {
						liveModels = runtime;
					},
				}))
			) {
				return;
			}
			await enableUnconfiguredPolicies(creds.access, enterpriseUrl, raw, context.signal);
		},
	};

	const commandRefresh = async (): Promise<RefreshResult> => {
		const credentials = await readStoredCredentials();
		if (!credentials?.access) {
			return { ok: false, error: "not logged in" };
		}
		try {
			const raw = await fetchCopilotModels(credentials.access, credentials.enterpriseUrl);
			const next = toProviderModels(raw, await loadPricingTable(), { contextMode });
			if (next.length === 0) {
				return { ok: false, error: "discovery returned no models" };
			}
			liveModels = toRuntimeModels(next, resolveCopilotBaseUrl(credentials.access, credentials.enterpriseUrl));
			pi.registerProvider(provider);
			await enableUnconfiguredPolicies(credentials.access, credentials.enterpriseUrl, raw);
			return { ok: true, count: next.length };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	};

	pi.registerProvider(provider);

	const refreshHandler = async (
		_args: unknown,
		ctx: { ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } },
	): Promise<void> => {
		const result = await commandRefresh();
		if (result.ok) {
			ctx.ui.notify(`pi-copilot-discovery: refreshed ${result.count} models`, "info");
		} else if (result.error === "not logged in") {
			ctx.ui.notify(
				"pi-copilot-discovery: not logged in. Run /login github-copilot.",
				"warning",
			);
		} else {
			ctx.ui.notify(`pi-copilot-discovery refresh failed: ${result.error}`, "error");
		}
	};

	pi.registerCommand("copilot-refresh", {
		description: "Re-fetch the GitHub Copilot model catalog from /models",
		// biome-ignore lint/suspicious/noExplicitAny: ExtensionAPI command ctx is loosely typed.
		handler: refreshHandler as any,
	});

	pi.registerCommand("copilot-discovery-refresh", {
		description: "Alias of /copilot-refresh (back-compat)",
		// biome-ignore lint/suspicious/noExplicitAny: ExtensionAPI command ctx is loosely typed.
		handler: refreshHandler as any,
	});

	pi.registerCommand("copilot-context", {
		description:
			"Set Copilot context mode: default (short-tier cap, cheaper) or long (full window). " +
			"Usage: /copilot-context [default|long|status]",
		handler: (async (
			args: unknown,
			ctx: { ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } },
		) => {
			const parsed = parseContextModeArg(args);
			if (parsed === "invalid") {
				ctx.ui.notify(
					`Usage: /copilot-context [default|long|status]. Current: ${contextMode}.`,
					"warning",
				);
				return;
			}
			if (parsed === "status") {
				const hint =
					contextMode === "default"
						? "Tiered models are capped at the short-context ceiling (cheaper rates)."
						: "Tiered models use the full window advertised by /models (long-context rates may apply).";
				ctx.ui.notify(`pi-copilot-discovery context mode: ${contextMode}. ${hint}`, "info");
				return;
			}

			if (parsed === contextMode) {
				ctx.ui.notify(`pi-copilot-discovery context mode already ${contextMode}.`, "info");
				return;
			}

			try {
				await saveContextMode(parsed);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to save context mode: ${msg}`, "error");
				return;
			}

			contextMode = parsed;
			const result = await commandRefresh();
			if (result.ok) {
				ctx.ui.notify(
					`pi-copilot-discovery context mode: ${contextMode} ` +
						`(${result.count} models re-registered).`,
					"info",
				);
			} else if (result.error === "not logged in") {
				ctx.ui.notify(
					`Context mode saved as ${contextMode}, but not logged in. ` +
						"Run /login github-copilot to apply.",
					"warning",
				);
			} else {
				ctx.ui.notify(
					`Context mode saved as ${contextMode}, but re-discovery failed: ${result.error}`,
					"error",
				);
			}
			// biome-ignore lint/suspicious/noExplicitAny: ExtensionAPI command ctx is loosely typed.
		}) as any,
	});
}
