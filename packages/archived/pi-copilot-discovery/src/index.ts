/**
 * pi-copilot-discovery — dynamic GitHub Copilot provider for pi.
 *
 * Simplified discovery model:
 *   - Register provider override immediately (without `models`) so pi's
 *     built-in static github-copilot catalog remains usable.
 *   - Run one best-effort `/models` discovery on startup (async).
 *   - Run one discovery immediately after successful `/login`.
 *   - Expose `/copilot-refresh` for manual re-discovery.
 *
 * Token refresh/persistence remains owned by pi's OAuth/auth-storage path.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import {
	type ContextMode,
	loadContextMode,
	parseContextModeArg,
	saveContextMode,
} from "./context-mode.ts";
import {
	createCopilotDiscoveryOAuth,
	type CopilotCredentials,
} from "./oauth.ts";
import { fetchCopilotModels, resolveCopilotBaseUrl, toProviderModels } from "./models.ts";
import { loadPricingTable } from "./pricing.ts";
import { streamCopilotDiscovery } from "./stream.ts";

const PROVIDER_NAME = "github-copilot";

type RefreshReason = "startup" | "login" | "command";
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

type StoredCredential = CopilotCredentials & { type?: string };

/**
 * Pull only the fields we need from auth.json. Never return a partial object
 * with a non-string access token, and never log credential material.
 */
function parseStoredCredential(entry: unknown): CopilotCredentials | null {
	if (!entry || typeof entry !== "object") return null;
	const rec = entry as StoredCredential;
	if (typeof rec.access !== "string" || rec.access.length === 0) return null;
	const out: CopilotCredentials = { access: rec.access };
	if (typeof rec.refresh === "string" && rec.refresh.length > 0) {
		out.refresh = rec.refresh;
	}
	if (typeof rec.expires === "number" && Number.isFinite(rec.expires)) {
		out.expires = rec.expires;
	}
	if (typeof rec.enterpriseUrl === "string" && rec.enterpriseUrl.length > 0) {
		out.enterpriseUrl = rec.enterpriseUrl;
	}
	// Preserve open-ended fields pi-ai may rely on, but only string/number/boolean
	// scalars — never nested objects that could smuggle unexpected structure.
	for (const [key, value] of Object.entries(rec)) {
		if (key === "access" || key === "refresh" || key === "expires" || key === "enterpriseUrl") {
			continue;
		}
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			(out as Record<string, string | number | boolean>)[key] = value;
		}
	}
	return out;
}

async function readStoredCredentials(): Promise<CopilotCredentials | null> {
	try {
		const buf = await readFile(getAuthPath(), "utf8");
		// Cap parse surface: auth.json is local but still untrusted input to us.
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

// Last-resort default ONLY when we have no token to derive the real host
// from. The correct host (individual vs. enterprise/GHE) is encoded in the
// Copilot token's `proxy-ep`; see resolveCopilotBaseUrl. Never send real
// traffic to this constant for an enterprise tenant — the proxy rejects it
// with 421 / "401 IDE token expired".
const DEFAULT_BASE_URL = "https://api.individual.githubcopilot.com";

const STATIC_PROVIDER_BASE: Omit<ProviderConfig, "models" | "oauth" | "baseUrl"> = {
	name: "GitHub Copilot",
	authHeader: true,
	api: "openai-completions",
	headers: {
		"User-Agent": "GitHubCopilotChat/0.35.0",
		"Editor-Version": "vscode/1.107.0",
		"Editor-Plugin-Version": "copilot-chat/0.35.0",
		"Copilot-Integration-Id": "vscode-chat",
	},
	streamSimple: streamCopilotDiscovery,
};

export default async function (pi: ExtensionAPI): Promise<void> {
	let models: ProviderConfig["models"] = [];

	// Provider baseUrl derived from the live token. Defaults only matter
	// until we see a token; after that it tracks the tenant's real proxy.
	let providerBaseUrl = DEFAULT_BASE_URL;

	// Cap tiered models at short-context ceilings by default (cheaper rates).
	// /copilot-context long opts into full advertised windows (~1M).
	let contextMode: ContextMode = await loadContextMode();

	const setBaseUrlFromCreds = (creds: CopilotCredentials | null | undefined): void => {
		if (creds?.access) {
			try {
				providerBaseUrl = resolveCopilotBaseUrl(creds.access, creds.enterpriseUrl);
			} catch {
				/* keep previous baseUrl */
			}
		}
	};

	let runRefresh: (
		reason: RefreshReason,
		credentialsOverride?: CopilotCredentials,
	) => Promise<RefreshResult>;

	const oauth = createCopilotDiscoveryOAuth({
		onLogin: async (credentials, onProgress) => {
			onProgress?.("Refreshing Copilot model catalog...");
			const result = await runRefresh("login", credentials);
			if (result.ok) {
				onProgress?.(`Loaded ${result.count} Copilot models`);
			} else {
				onProgress?.(`Model discovery after login failed: ${result.error}`);
			}
		},
	});

	const registerProvider = (nextModels?: ProviderConfig["models"]): void => {
		const base = { ...STATIC_PROVIDER_BASE, baseUrl: providerBaseUrl, oauth };
		if (nextModels) {
			pi.registerProvider(PROVIDER_NAME, { ...base, models: nextModels });
			return;
		}
		// Override-only mode: keep built-in static catalog; replace oauth + streamSimple.
		pi.registerProvider(PROVIDER_NAME, base);
	};

	// Discover models, transparently refreshing a stale stored token ONCE
	// (in memory, delegated to pi-ai's built-in refresh — never written to
	// auth.json; pi owns persistence). Without this, reopening pi after the
	// short-lived Copilot token expired would silently drop the tenant
	// catalog until the next manual /copilot-refresh.
	const fetchWithStaleTokenRetry = async (
		credentials: CopilotCredentials,
	): Promise<Awaited<ReturnType<typeof fetchCopilotModels>>> => {
		try {
			return await fetchCopilotModels(credentials.access, credentials.enterpriseUrl);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!/\b401\b/.test(msg) || typeof credentials.refresh !== "string") {
				throw err;
			}
			const refreshed = (await oauth.refreshToken(credentials)) as CopilotCredentials;
			setBaseUrlFromCreds(refreshed);
			return await fetchCopilotModels(refreshed.access, refreshed.enterpriseUrl);
		}
	};

	runRefresh = async (reason, credentialsOverride) => {
		const credentials = credentialsOverride ?? (await readStoredCredentials());
		if (!credentials?.access) {
			return { ok: false, error: "not logged in" };
		}
		// Point the provider at the tenant's real proxy BEFORE registering, so
		// neither the override-only nor the with-models registration leaves an
		// enterprise tenant pinned to the individual host.
		setBaseUrlFromCreds(credentials);
		try {
			const raw = await fetchWithStaleTokenRetry(credentials);
			// Reload pricing each discovery so user overrides apply without restart.
			const pricing = await loadPricingTable();
			const next = toProviderModels(raw, pricing, { contextMode });
			if (next.length === 0) {
				return { ok: false, error: "discovery returned no models" };
			}
			models = next;
			registerProvider(models);
			return { ok: true, count: next.length };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// Never downgrade an already-loaded live catalog, but DO re-register
			// the override so the corrected baseUrl takes effect.
			if (models.length === 0) {
				registerProvider();
			}
			if (reason !== "command") {
				console.error(`pi-copilot-discovery: ${reason} discovery failed (${msg})`);
			}
			return { ok: false, error: msg };
		}
	};

	// Seed the baseUrl from any stored token BEFORE the first registration so
	// the override-only catalog routes to the correct (possibly enterprise)
	// host even before discovery completes.
	const startupCreds = await readStoredCredentials();
	setBaseUrlFromCreds(startupCreds);

	// Register override immediately so login/stream behavior is active even
	// before discovery completes (with the correct, token-derived baseUrl).
	registerProvider();

	// Await the initial discovery so the model catalog is registered before
	// the first turn. This makes model resolution deterministic (no "model
	// not found, using custom id" fallback to a default host) and avoids
	// registering on a torn-down session. fetchCopilotModels has a 10s
	// timeout, and a missing/failed discovery still leaves the override-only
	// provider registered, so this can't hang startup indefinitely.
	await runRefresh("startup", startupCreds ?? undefined);

	const refreshHandler = async (
		_args: unknown,
		ctx: { ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } },
	): Promise<void> => {
		const result = await runRefresh("command");
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
			const result = await runRefresh("command");
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
