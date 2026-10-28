/**
 * Variable cost: every message in the compaction-aware transcript, split into blocks
 * (one per content part that costs context) and grouped into turns by provider request.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextMessage } from "./snapshot.ts";
import { IMAGE_CHARS, jsonChars, preview } from "./units.ts";

export type Slot =
	| { kind: "user" }
	| { kind: "reply" }
	| { kind: "thinking" }
	| { kind: "tool-call"; tool: string }
	| { kind: "tool-result"; tool: string }
	| { kind: "bash" }
	| { kind: "injected"; customType: string }
	| { kind: "summary"; source: "compaction" | "branch" }
	| { kind: "other"; role: string };

export interface Block {
	slot: Slot;
	entryId: string;
	/** Number of the provider request in which this block first reaches the model. */
	turn: number;
	chars: number;
	images: number;
	/** What produced it, e.g. `read src/a.ts`. */
	label: string;
	/** Stable identity for "same call repeated": tool name plus canonical arguments. */
	callKey?: string;
}

export interface Turn {
	index: number;
	/** Provider-reported prompt size for the request behind this reply. */
	promptTokens: number | null;
	/** Blocks added to the context since the previous request. */
	arrived: Block[];
}

export interface Conversation {
	blocks: Block[];
	turns: Turn[];
	/**
	 * Opaque reasoning payloads attached to replies. Whether a provider counts them toward context
	 * depends on the provider, so they are reported but never priced into `Block.chars`.
	 */
	signatureChars: number;
}

interface CallInfo {
	tool: string;
	summary: string;
	/** Undefined for calls with huge arguments (writes, edits), whose results are small and not worth comparing. */
	key: string | undefined;
}

const MAX_KEYED_ARGUMENT_CHARS = 2000;

const ARGUMENT_HINTS = ["path", "file_path", "filePath", "command", "url", "query", "pattern", "task", "agent", "name"];

function summarizeArguments(args: Record<string, unknown>): string {
	for (const key of ARGUMENT_HINTS) {
		const value = args[key];
		if (typeof value === "string" && value) return preview(value, 90);
	}
	const first = Object.values(args).find((v): v is string => typeof v === "string" && v.length > 0);
	return first ? preview(first, 90) : "";
}

function contentCost(content: string | readonly { type: string; text?: string }[]) {
	if (typeof content === "string") return { chars: content.length, images: 0, text: content };
	let chars = 0;
	let images = 0;
	let text = "";
	for (const part of content) {
		if (part.type === "image") images++;
		else if (typeof part.text === "string") {
			chars += part.text.length;
			if (!text) text = part.text;
		}
	}
	return { chars: chars + images * IMAGE_CHARS, images, text };
}

/**
 * Replies kept across a compaction report usage measured against the old, larger context,
 * so only replies made after the latest compaction are comparable.
 */
function usagePromptTokens(message: Extract<AgentMessage, { role: "assistant" }>, compactedAt: number): number | null {
	if (message.stopReason === "error" || message.stopReason === "aborted") return null;
	if (message.timestamp <= compactedAt) return null;
	const { input, cacheRead, cacheWrite } = message.usage;
	const total = input + cacheRead + cacheWrite;
	return total > 0 ? total : null;
}

export function analyzeConversation(messages: readonly ContextMessage[]): Conversation {
	const blocks: Block[] = [];
	const turns: Turn[] = [];
	const calls = new Map<string, CallInfo>();
	let turn = 1;
	let signatureChars = 0;
	let compactedAt = Number.NEGATIVE_INFINITY;
	/** Blocks produced since the last assistant reply was measured; they arrive in the next request. */
	let carry: Block[] = [];

	const add = (block: Omit<Block, "turn">) => {
		const full = { ...block, turn };
		blocks.push(full);
		carry.push(full);
	};

	for (const { entryId, message } of messages) {
		switch (message.role) {
			case "user": {
				const { chars, images, text } = contentCost(message.content);
				add({ slot: { kind: "user" }, entryId, chars, images, label: preview(text, 90) });
				break;
			}
			case "assistant": {
				turns.push({ index: turn, promptTokens: usagePromptTokens(message, compactedAt), arrived: carry });
				carry = [];
				turn++;
				for (const part of message.content) {
					if (part.type === "text") {
						signatureChars += part.textSignature?.length ?? 0;
						add({ slot: { kind: "reply" }, entryId, chars: part.text.length, images: 0, label: preview(part.text, 90) });
					} else if (part.type === "thinking") {
						signatureChars += part.thinkingSignature?.length ?? 0;
						add({ slot: { kind: "thinking" }, entryId, chars: part.thinking.length, images: 0, label: preview(part.thinking, 90) });
					} else {
						signatureChars += part.thoughtSignature?.length ?? 0;
						const args = JSON.stringify(part.arguments) ?? "";
						const key = args.length <= MAX_KEYED_ARGUMENT_CHARS ? `${part.name} ${args}` : undefined;
						const summary = summarizeArguments(part.arguments);
						calls.set(part.id, { tool: part.name, summary, key });
						add({
							slot: { kind: "tool-call", tool: part.name },
							entryId,
							chars: part.name.length + args.length,
							images: 0,
							label: `${part.name} ${summary}`.trim(),
						});
					}
				}
				break;
			}
			case "toolResult": {
				const call = calls.get(message.toolCallId);
				const { chars, images } = contentCost(message.content);
				add({
					slot: { kind: "tool-result", tool: message.toolName },
					entryId,
					chars,
					images,
					label: `${message.toolName} ${call?.summary ?? ""}`.trim(),
					callKey: call?.key,
				});
				break;
			}
			case "bashExecution": {
				if (message.excludeFromContext) break;
				add({
					slot: { kind: "bash" },
					entryId,
					chars: message.command.length + message.output.length,
					images: 0,
					label: `! ${preview(message.command, 90)}`,
				});
				break;
			}
			case "custom": {
				const { chars, images, text } = contentCost(message.content);
				add({
					slot: { kind: "injected", customType: message.customType },
					entryId,
					chars,
					images,
					label: `${message.customType}: ${preview(text, 70)}`,
				});
				break;
			}
			case "compactionSummary":
			case "branchSummary": {
				if (message.role === "compactionSummary") compactedAt = message.timestamp;
				add({
					slot: { kind: "summary", source: message.role === "compactionSummary" ? "compaction" : "branch" },
					entryId,
					chars: message.summary.length,
					images: 0,
					label: preview(message.summary, 90),
				});
				break;
			}
			default: {
				// The system prompt is covered by the setup analysis; unknown roles are counted, not dropped.
				const role: string = message.role;
				if (role === "system") break;
				add({ slot: { kind: "other", role }, entryId, chars: jsonChars(message), images: 0, label: role });
			}
		}
	}
	return { blocks, turns, signatureChars };
}
