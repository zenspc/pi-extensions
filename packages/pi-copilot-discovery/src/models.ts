/**
 * Fetch and normalize the Copilot tenant's model catalog.
 *
 * The Copilot `/models` endpoint is the source of truth for what the
 * signed-in account is entitled to — including preview / tenant-private
 * models that don't appear in any static pi-ai list.
 *
 * Returned `ProviderModelConfig` entries carry per-model `api` overrides
 * so a single `github-copilot` provider can host Anthropic, OpenAI
 * Responses, and OpenAI Completions backed models in one list.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getGitHubCopilotBaseUrl, normalizeDomain } from "@earendil-works/pi-ai/oauth";
import { classify } from "./families.ts";
import {
	type ContextMode,
	type PricingTable,
	resolveContextWindow,
	resolveModelCost,
} from "./pricing.ts";

/**
 * Static Copilot client identification headers.
 * Kept in sync with pi-ai's built-in github-copilot provider
 * (`COPILOT_HEADERS` in pi-ai/src/utils/oauth/github-copilot.ts).
 * Bump together when pi-ai bumps.
 */
export const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
} as const;

export type CopilotModel = {
	id: string;
	name?: string;
	capabilities?: {
		type?: string;
		family?: string;
		tokenizer?: string;
		limits?: {
			max_context_window_tokens?: number;
			max_output_tokens?: number;
			max_prompt_tokens?: number;
		};
		supports?: {
			vision?: boolean;
			tool_calls?: boolean;
			streaming?: boolean;
		};
	};
	model_picker_enabled?: boolean;
	policy?: { state?: "enabled" | "disabled" | "unconfigured" };
};

/** Hard cap on models accepted from a single /models response. */
const MAX_MODELS = 500;

/** Hard caps on token limits advertised by /models (defensive against garbage values). */
const MAX_CONTEXT_WINDOW = 2_000_000;
const MAX_OUTPUT_TOKENS = 512_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * Model ids are untrusted (they come from the tenant /models endpoint).
 * Restrict to the shape Copilot actually ships so path construction and
 * provider registration cannot be steered by odd characters.
 *
 * Accepts: gpt-4o, claude-sonnet-4.5, gpt-5.2-codex, o3-mini, etc.
 * Deliberately excludes characters that would change under encodeURIComponent
 * (e.g. `:`) so path encoding is a pure no-op for accepted ids.
 */
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeModelId(id: unknown): id is string {
	return typeof id === "string" && SAFE_MODEL_ID.test(id);
}

/** Truncate remote error bodies before they land in logs or UI notifies. */
export function truncateForError(text: string, max = 200): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	return `${flat.slice(0, max)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.min(Math.floor(value), max);
}

/** Strip control chars from display names; never let raw remote text go wild. */
function sanitizeDisplayName(name: string, fallback: string): string {
	const cleaned = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
	if (!cleaned) return fallback;
	return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

function parseCopilotModels(body: unknown): CopilotModel[] {
	const root = asRecord(body);
	const data = root?.data;
	if (!Array.isArray(data)) {
		throw new Error("copilot /models: invalid response shape (expected { data: [] })");
	}

	const out: CopilotModel[] = [];
	for (const raw of data) {
		if (out.length >= MAX_MODELS) break;
		const item = asRecord(raw);
		if (!item || !isSafeModelId(item.id)) continue;

		const capabilities = asRecord(item.capabilities);
		const limits = asRecord(capabilities?.limits);
		const supports = asRecord(capabilities?.supports);
		const policy = asRecord(item.policy);

		out.push({
			id: item.id,
			name: typeof item.name === "string" ? item.name : undefined,
			model_picker_enabled:
				typeof item.model_picker_enabled === "boolean"
					? item.model_picker_enabled
					: undefined,
			policy:
				policy &&
				(policy.state === "enabled" ||
					policy.state === "disabled" ||
					policy.state === "unconfigured")
					? { state: policy.state }
					: undefined,
			capabilities: capabilities
				? {
						type: typeof capabilities.type === "string" ? capabilities.type : undefined,
						family:
							typeof capabilities.family === "string" ? capabilities.family : undefined,
						tokenizer:
							typeof capabilities.tokenizer === "string"
								? capabilities.tokenizer
								: undefined,
						limits: limits
							? {
									max_context_window_tokens:
										typeof limits.max_context_window_tokens === "number"
											? limits.max_context_window_tokens
											: undefined,
									max_output_tokens:
										typeof limits.max_output_tokens === "number"
											? limits.max_output_tokens
											: undefined,
									max_prompt_tokens:
										typeof limits.max_prompt_tokens === "number"
											? limits.max_prompt_tokens
											: undefined,
								}
							: undefined,
						supports: supports
							? {
									vision: supports.vision === true ? true : undefined,
									tool_calls: supports.tool_calls === true ? true : undefined,
									streaming: supports.streaming === true ? true : undefined,
								}
							: undefined,
					}
				: undefined,
		});
	}
	return out;
}

/**
 * Resolve the correct Copilot API base URL for a given token.
 *
 * CRITICAL: the host is encoded in the token's `proxy-ep` field, NOT a
 * constant. Individual plans use `api.individual.githubcopilot.com`;
 * business/enterprise tenants use `api.enterprise.githubcopilot.com` (or
 * a GHE-specific host). Hardcoding `api.individual...` sends enterprise
 * tokens to the wrong proxy — the server then rejects with `421 Misdirected
 * Request` or a misleading `401 ... IDE token expired`. Always derive the
 * base URL from the live token.
 */
export function resolveCopilotBaseUrl(token: string, enterpriseUrl?: string): string {
	const domain = enterpriseUrl ? (normalizeDomain(enterpriseUrl) ?? undefined) : undefined;
	return getGitHubCopilotBaseUrl(token, domain);
}

export async function fetchCopilotModels(
	copilotToken: string,
	enterpriseUrl?: string,
): Promise<CopilotModel[]> {
	const baseUrl = resolveCopilotBaseUrl(copilotToken, enterpriseUrl);
	const res = await fetch(`${baseUrl}/models`, {
		headers: {
			Authorization: `Bearer ${copilotToken}`,
			Accept: "application/json",
			...COPILOT_HEADERS,
		},
		// Never let a slow/hung discovery block pi startup indefinitely.
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) {
		const body = truncateForError(await res.text().catch(() => ""));
		throw new Error(`copilot /models: ${res.status}${body ? ` ${body}` : ""}`);
	}
	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		throw new Error("copilot /models: response was not valid JSON");
	}
	// /models is untrusted remote input — parse defensively, drop bad rows.
	return parseCopilotModels(raw).filter(
		(m) => m.model_picker_enabled !== false && m.capabilities?.type === "chat",
	);
}

export type ToProviderModelsOptions = {
	/** Prefer short-tier caps ("default") or full advertised windows ("long"). */
	contextMode?: ContextMode;
};

export function toProviderModels(
	models: CopilotModel[],
	pricing: PricingTable = {},
	options: ToProviderModelsOptions = {},
): ProviderModelConfig[] {
	const contextMode = options.contextMode ?? "default";
	// Some tenants return multiple entries with the same `id` (e.g. a
	// model and a vision variant). Keep the first by id so /model is sane.
	const seen = new Set<string>();
	const out: ProviderModelConfig[] = [];
	for (const m of models) {
		if (!isSafeModelId(m.id) || seen.has(m.id)) continue;
		seen.add(m.id);

		const familyOrId =
			typeof m.capabilities?.family === "string" && m.capabilities.family.length > 0
				? m.capabilities.family
				: m.id;
		const { api, reasoning, thinkingLevelMap, compat } = classify(familyOrId);
		const vision = m.capabilities?.supports?.vision === true;
		const limits = m.capabilities?.limits ?? {};
		const advertised = positiveInt(
			limits.max_context_window_tokens ?? limits.max_prompt_tokens,
			DEFAULT_CONTEXT_WINDOW,
			MAX_CONTEXT_WINDOW,
		);

		out.push({
			id: m.id,
			name: sanitizeDisplayName(m.name ?? m.id, m.id),
			api,
			reasoning,
			thinkingLevelMap,
			compat,
			input: vision ? ["text", "image"] : ["text"],
			contextWindow: resolveContextWindow(advertised, m.id, pricing, contextMode),
			maxTokens: positiveInt(
				limits.max_output_tokens,
				DEFAULT_MAX_TOKENS,
				MAX_OUTPUT_TOKENS,
			),
			// Static rates from pricing.json (+ optional user override).
			// Unknown ids stay at zero so discovery never fails on a missing price.
			cost: resolveModelCost(m.id, pricing),
		});
	}
	return out;
}
