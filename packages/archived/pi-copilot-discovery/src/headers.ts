/**
 * Local re-implementation of pi-ai's Copilot dynamic headers.
 *
 * Source of truth:
 *   node_modules/@earendil-works/pi-ai/src/providers/github-copilot-headers.ts
 *
 * pi-ai injects these headers automatically only when `model.provider`
 * is the literal string `"github-copilot"` *and* its own built-in stream
 * handler is running. We register under `github-copilot` (required — do
 * not rename) but override `streamSimple`, so we re-inject the headers
 * ourselves via the streamSimple wrapper (see `stream.ts`).
 *
 * Why this matters:
 *  - `X-Initiator: agent` keeps non-interactive (tool follow-up) calls
 *    off the interactive Copilot Chat quota.
 *  - `Openai-Intent: conversation-edits` keeps Claude multi-turn behavior
 *    correct.
 *  - `Copilot-Vision-Request: true` is required for image inputs to be
 *    accepted by the proxy.
 */

import type { Message } from "@earendil-works/pi-ai";

export function inferCopilotInitiator(messages: Message[]): "user" | "agent" {
	const last = messages[messages.length - 1];
	return last && last.role !== "user" ? "agent" : "user";
}

export function hasCopilotVisionInput(messages: Message[]): boolean {
	return messages.some((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			return msg.content.some((c) => c.type === "image");
		}
		if (msg.role === "toolResult" && Array.isArray(msg.content)) {
			return msg.content.some((c) => c.type === "image");
		}
		return false;
	});
}

export function buildCopilotDynamicHeaders(messages: Message[]): Record<string, string> {
	const headers: Record<string, string> = {
		"X-Initiator": inferCopilotInitiator(messages),
		"Openai-Intent": "conversation-edits",
	};
	if (hasCopilotVisionInput(messages)) {
		headers["Copilot-Vision-Request"] = "true";
	}
	return headers;
}
