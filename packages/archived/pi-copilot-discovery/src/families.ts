/**
 * Classify a Copilot model into the right pi-ai api family.
 *
 * Heuristics derived from pi-ai's own static `github-copilot` model table
 * (`node_modules/@earendil-works/pi-ai/dist/models.generated.js`) so this
 * routes the same way pi-ai routes its built-in Copilot models:
 *
 *   - claude-*   → anthropic-messages   (reasoning where supported)
 *   - gpt-5*     → openai-responses     (reasoning)
 *   - o1, o3     → openai-responses     (reasoning)
 *   - gpt-4*     → openai-completions   (no reasoning)
 *   - gemini-*   → openai-completions   (Copilot proxies Gemini through
 *                                        an OpenAI-compatible endpoint;
 *                                        DO NOT route to google-generative-ai)
 *   - grok-*     → openai-completions
 *   - default    → openai-completions   (safe, widely supported)
 *
 * Heuristics are intentionally conservative — when uncertain we choose
 * an api the model is *usable* under even if it is not optimal.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

type ThinkingLevelMap = Model<Api>["thinkingLevelMap"];
type Compat = Model<Api>["compat"];

export type ApiFamily = {
	api: Api;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	compat?: Compat;
};

const OPENAI_RESPONSES_THINKING: ThinkingLevelMap = {
	off: null,
	minimal: "low",
};

// gpt-5.2 and newer (incl. codex / mini / nano variants) expose an extra
// "xhigh" reasoning tier; base gpt-5 and gpt-5-mini do NOT. Advertising
// xhigh for a model that lacks it makes the proxy reject requests with
// 400 "Unsupported value: 'xhigh'". Mirror pi-ai's built-in catalog.
const OPENAI_RESPONSES_THINKING_XHIGH: ThinkingLevelMap = {
	off: null,
	minimal: "low",
	xhigh: "xhigh",
};

export function classify(familyOrId: string): ApiFamily {
	const s = familyOrId.toLowerCase();

	// ---- Claude (Anthropic Messages API) ----
	if (s.startsWith("claude")) {
		// Match both Copilot id formats:
		//   claude-{kind}-{version}  (e.g. claude-haiku-4.5, claude-opus-4.7)
		//   claude-{version}-{kind}  (e.g. claude-3.7-sonnet, claude-3.5-haiku)
		//
		// Reasoning support: 3.5 introduced extended thinking on Sonnet; 3.7
		// and the 4.x / 5.x line broadened it. Default reasoning to true
		// unless the id clearly says Claude 3 (non-3.5/3.7) or earlier.
		const isClaude3OrOlder = /claude-(3(?!\.[57])|2|1)/.test(s) && !/-4|-5|-6|-7|-8|-9/.test(s);
		const reasoning = !isClaude3OrOlder;

		// pi-ai's built-in entries set forceAdaptiveThinking on Opus 4.6+
		// and Sonnet 4.6+. Mirror that.
		const needsAdaptive =
			/claude-opus-(4\.[6-9]|[5-9])/.test(s) || /claude-sonnet-(4\.[6-9]|[5-9])/.test(s);

		// Opus 4.7+ has an "xhigh" tier that maps to provider "xhigh".
		const xhighMax = /claude-opus-(4\.[7-9]|[5-9])/.test(s);

		const compat: Compat | undefined = needsAdaptive
			? { forceAdaptiveThinking: true }
			: undefined;

		return {
			api: "anthropic-messages",
			reasoning,
			thinkingLevelMap: xhighMax ? { xhigh: "xhigh" } : undefined,
			compat,
		};
	}

	// ---- OpenAI reasoning families (Responses API) ----
	if (/^(gpt-5|o1|o3)/.test(s)) {
		const supportsXhigh = /gpt-5\.(?:[2-9]|\d\d)/.test(s);
		return {
			api: "openai-responses",
			reasoning: true,
			thinkingLevelMap: supportsXhigh
				? OPENAI_RESPONSES_THINKING_XHIGH
				: OPENAI_RESPONSES_THINKING,
		};
	}

	// ---- Everything else → OpenAI Chat Completions (no reasoning) ----
	// This intentionally includes:
	//   - gpt-4o, gpt-4.1, gpt-4-* (no native reasoning)
	//   - gemini-* (Copilot proxies as OpenAI-compatible)
	//   - grok-* (Copilot proxies as OpenAI-compatible)
	//   - any unknown new family
	return { api: "openai-completions", reasoning: false };
}
