/**
 * OAuth wiring for the `github-copilot` provider.
 *
 * IMPORTANT — token lifecycle is owned entirely by pi-ai's built-in
 * GitHub Copilot OAuth provider. We do NOT reimplement login, token
 * refresh, or credential persistence. We *delegate* every one of those
 * to `githubCopilotOAuthProvider` so the device-code grant is minted,
 * refreshed, and stored byte-for-byte identically to a vanilla pi
 * install with no extension. This avoids a parallel mint/refresh cycle
 * (the original cause of GitHub revoking the device-flow grant — the
 * "token wiped out after short periods" symptom).
 *
 * The ONLY thing we override is `modifyModels`: the built-in filters
 * the model list down to `availableModelIds`, which would strip the
 * tenant-private / preview models this extension exists to surface.
 * Ours rewrites baseUrl for every github-copilot model and filters
 * nothing.
 *
 * An optional `onLogin` hook lets `index.ts` re-discover the catalog
 * once after `/login`, so users don't need to restart. It never mints
 * or refreshes tokens.
 */

import type {
	Api,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthProviderInterface,
} from "@earendil-works/pi-ai";
import {
	getGitHubCopilotBaseUrl,
	githubCopilotOAuthProvider,
	normalizeDomain,
} from "@earendil-works/pi-ai/oauth";
import {
	COPILOT_HEADERS,
	type CopilotModel,
	fetchCopilotModels,
	isSafeModelId,
} from "./models.ts";

export type CopilotCredentials = OAuthCredentials & { enterpriseUrl?: string };

/** Bound concurrent policy POSTs so a large catalog cannot stampede the proxy. */
const POLICY_CONCURRENCY = 8;
const POLICY_TIMEOUT_MS = 10_000;

/**
 * Canonical provider name. Keeping it `github-copilot` makes this a
 * drop-in override of pi-ai's built-in provider.
 */
const PROVIDER_NAME = "github-copilot";

type OAuthHooks = {
	onLogin?: (
		credentials: CopilotCredentials,
		onProgress?: (message: string) => void,
	) => Promise<void> | void;
};

/**
 * Enable a single model on the user's account by POSTing to
 * `/models/<id>/policy`. Uses the short-lived Copilot *access* token —
 * never the device-flow grant — so it cannot affect token lifecycle.
 */
async function enablePolicy(
	copilotToken: string,
	enterpriseUrl: string | undefined,
	modelId: string,
): Promise<boolean> {
	// Model ids are remote input; reject anything outside the known shape and
	// always encode the path segment so a crafted id cannot rewrite the URL.
	if (!isSafeModelId(modelId)) return false;
	const domain = enterpriseUrl ? (normalizeDomain(enterpriseUrl) ?? undefined) : undefined;
	const baseUrl = getGitHubCopilotBaseUrl(copilotToken, domain);
	try {
		const res = await fetch(`${baseUrl}/models/${encodeURIComponent(modelId)}/policy`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${copilotToken}`,
				...COPILOT_HEADERS,
				"openai-intent": "chat-policy",
				"x-interaction-type": "chat-policy",
			},
			body: JSON.stringify({ state: "enabled" }),
			signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** One-time policy enable across discovered models. Login-only, token-safe. */
async function enableAllPolicies(
	copilotToken: string,
	enterpriseUrl: string | undefined,
	models: CopilotModel[],
): Promise<void> {
	// Bounded pool: avoid opening hundreds of concurrent POSTs on large catalogs.
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(POLICY_CONCURRENCY, models.length) },
		async () => {
			while (next < models.length) {
				const i = next++;
				await enablePolicy(copilotToken, enterpriseUrl, models[i]!.id);
			}
		},
	);
	await Promise.all(workers);
}

export function createCopilotDiscoveryOAuth(hooks: OAuthHooks = {}): OAuthProviderInterface {
	const builtin = githubCopilotOAuthProvider;

	return {
		id: PROVIDER_NAME,
		name: builtin.name,
		usesCallbackServer: builtin.usesCallbackServer,

		/** Delegate login verbatim to pi-ai; only add a non-fatal discovery hook. */
		async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
			const creds = (await builtin.login(callbacks)) as CopilotCredentials;
			// Enable policies across the tenant catalog (one-time, non-fatal,
			// uses the access token only — does not touch the grant).
			try {
				const models = await fetchCopilotModels(creds.access, creds.enterpriseUrl);
				callbacks.onProgress?.(`Enabling ${models.length} work-tenant models...`);
				await enableAllPolicies(creds.access, creds.enterpriseUrl, models);
			} catch (err) {
				callbacks.onProgress?.(
					`Could not enable all policies: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			if (hooks.onLogin) {
				try {
					await hooks.onLogin(creds, callbacks.onProgress);
				} catch (err) {
					callbacks.onProgress?.(
						`Could not refresh model catalog after login: ${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}
			}
			return creds;
		},

		/** Delegate refresh verbatim — never run a parallel refresh. */
		refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
			return builtin.refreshToken(credentials);
		},

		getApiKey(credentials: OAuthCredentials): string {
			return builtin.getApiKey(credentials);
		},

		/**
		 * Per request, rewrite every `github-copilot` model's baseUrl to the
		 * proxy endpoint encoded in the current Copilot token. Unlike the
		 * built-in, we do NOT filter by availableModelIds — that's the whole
		 * point of dynamic discovery.
		 */
		modifyModels(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
			const creds = credentials as CopilotCredentials;
			const domain = creds.enterpriseUrl
				? (normalizeDomain(creds.enterpriseUrl) ?? undefined)
				: undefined;
			const baseUrl = getGitHubCopilotBaseUrl(creds.access, domain);
			return models.map((m) => (m.provider === PROVIDER_NAME ? { ...m, baseUrl } : m));
		},
	};
}

// Backward-compatible default export shape for any external import.
export const copilotDiscoveryOAuth = createCopilotDiscoveryOAuth();
