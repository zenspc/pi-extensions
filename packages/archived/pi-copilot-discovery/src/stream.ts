/**
 * streamSimple wrapper for the `github-copilot` provider, replacing
 * pi-ai's built-in handler.
 *
 * Two jobs:
 *
 *   1. Re-inject the Copilot dynamic headers (`X-Initiator`,
 *      `Openai-Intent`, optional `Copilot-Vision-Request`). pi-ai's
 *      built-in streamers add these automatically when
 *      `model.provider === "github-copilot"`, but only when its own
 *      built-in handler is the one running. Because we override
 *      `streamSimple`, we re-inject them ourselves to preserve the
 *      same on-the-wire behavior — including the agent-vs-user
 *      quota accounting and vision support.
 *
 *   2. Dispatch to the correct pi-ai built-in streamer based on the
 *      per-model `api` override. We never re-implement a streamer; we
 *      strictly delegate.
 */

import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
	streamSimpleOpenAIResponses,
} from "@earendil-works/pi-ai";
import { buildCopilotDynamicHeaders } from "./headers.ts";

export function streamCopilotDiscovery(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const dynamicHeaders = buildCopilotDynamicHeaders(context.messages);
	const mergedHeaders = { ...(options?.headers ?? {}), ...dynamicHeaders };
	const innerOptions: SimpleStreamOptions = { ...options, headers: mergedHeaders };

	switch (model.api) {
		case "anthropic-messages":
			return streamSimpleAnthropic(
				model as Model<"anthropic-messages">,
				context,
				innerOptions,
			);
		case "openai-responses":
			return streamSimpleOpenAIResponses(
				model as Model<"openai-responses">,
				context,
				innerOptions,
			);
		case "openai-completions":
			return streamSimpleOpenAICompletions(
				model as Model<"openai-completions">,
				context,
				innerOptions,
			);
		default:
			return errorStream(
				model,
				`pi-copilot-discovery: unsupported api "${model.api}" for model ${model.id}. ` +
					`Expected one of: anthropic-messages, openai-responses, openai-completions.`,
			);
	}
}

function errorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({
			type: "error",
			reason: "error",
			error: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				errorMessage: message,
				timestamp: Date.now(),
			},
		});
		stream.end();
	});
	return stream;
}
