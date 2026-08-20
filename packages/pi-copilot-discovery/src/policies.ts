/**
 * Enable unconfigured Copilot models via POST /models/<id>/policy.
 * Uses the short-lived access token only — never the device-flow grant.
 */

import {
	COPILOT_HEADERS,
	type CopilotModel,
	isSafeModelId,
	resolveCopilotBaseUrl,
} from "./models.ts";

const POLICY_CONCURRENCY = 4;
const POLICY_TIMEOUT_MS = 10_000;

async function enablePolicy(
	copilotToken: string,
	enterpriseUrl: string | undefined,
	modelId: string,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!isSafeModelId(modelId)) return false;
	const baseUrl = resolveCopilotBaseUrl(copilotToken, enterpriseUrl);
	const timeout = AbortSignal.timeout(POLICY_TIMEOUT_MS);
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
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** POST policy enable only for models still marked unconfigured. */
export async function enableUnconfiguredPolicies(
	copilotToken: string,
	enterpriseUrl: string | undefined,
	models: CopilotModel[],
	signal?: AbortSignal,
): Promise<void> {
	const pending = models.filter((m) => m.policy?.state === "unconfigured");
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(POLICY_CONCURRENCY, pending.length) },
		async () => {
			while (next < pending.length) {
				if (signal?.aborted) return;
				const i = next++;
				await enablePolicy(copilotToken, enterpriseUrl, pending[i]!.id, signal);
			}
		},
	);
	await Promise.all(workers);
}
