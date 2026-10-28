/**
 * Character counts are exact; token counts are not, and the ratio varies by model and content.
 * The provider's own numbers are the only ground truth, so use them to price each part of the context.
 */
import type { Conversation } from "./conversation.ts";
import { DEFAULT_TOKENS_PER_CHAR, sum, type Rates } from "./units.ts";

export interface Calibration {
	rates: Rates;
	/** True when the rates were derived from provider-reported token counts. */
	measured: boolean;
}

/** The first request is mostly fixed overhead; beyond this share it says little about the setup alone. */
const MAX_FIRST_REQUEST_ARRIVAL_SHARE = 0.25;

export interface CalibrationInput {
	measuredTokens: number | null;
	setupChars: number;
	conversation: Conversation;
	conversationChars: number;
}

export function calibrate({ measuredTokens, setupChars, conversation, conversationChars }: CalibrationInput): Calibration {
	const assumed: Calibration = {
		rates: { setup: DEFAULT_TOKENS_PER_CHAR, conversation: DEFAULT_TOKENS_PER_CHAR },
		measured: false,
	};
	if (!measuredTokens || setupChars + conversationChars <= 0) return assumed;

	const uniform = measuredTokens / (setupChars + conversationChars);
	const fallback: Calibration = { rates: { setup: uniform, conversation: uniform }, measured: true };

	// The first request contains the fixed overhead plus only what arrived with it, which isolates the setup rate.
	const first = conversation.turns[0];
	if (!first?.promptTokens || setupChars <= 0 || conversationChars <= 0) return fallback;
	const arrivedTokens = sum(first.arrived, (b) => b.chars) * DEFAULT_TOKENS_PER_CHAR;
	if (arrivedTokens > first.promptTokens * MAX_FIRST_REQUEST_ARRIVAL_SHARE) return fallback;

	const setupTokens = first.promptTokens - arrivedTokens;
	const conversationTokens = measuredTokens - setupTokens;
	if (conversationTokens <= 0) return fallback;
	return {
		rates: { setup: setupTokens / setupChars, conversation: conversationTokens / conversationChars },
		measured: true,
	};
}
