import { randomUUID } from "node:crypto";
import type { Context, Message, TextContent } from "@earendil-works/pi-ai";
import {
	convertToLlm,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT =
	"Answer the user's side question using the supplied conversation as background, not as a task to continue. " +
	"This discussion is separate from the main task. You have no tools and cannot read files, run commands, or search. " +
	"If the context does not contain the answer, say so. Do not claim to have performed new actions.";

export type Exchange = {
	question: string;
	answer: string;
	state: "streaming" | "complete" | "error";
};

/** A detached, tool-free snapshot that respects compaction and context edits. */
export function conversationSnapshot(ctx: ExtensionContext): Message[] {
	const messages = convertToLlm(
		ctx.sessionManager.buildSessionProjection().messages
	);
	return structuredClone(
		messages.flatMap((message): Message[] => {
			if (message.role === "system") return [];
			if (message.role === "user") return [message];
			if (message.role === "toolResult") {
				return [
					{
						role: "user",
						timestamp: message.timestamp,
						content: [
							{
								type: "text",
								text: `[Earlier tool result: ${message.toolName}]`,
							},
							...message.content,
						],
					},
				];
			}
			// Keep tool calls as historical text, never as executable protocol blocks.
			const content = message.content.flatMap((block): TextContent[] => {
				if (block.type === "text")
					return [{ type: "text", text: block.text }];
				if (block.type === "toolCall")
					return [
						{
							type: "text",
							text: `[Earlier tool call: ${
								block.name
							} ${JSON.stringify(block.arguments)}]`,
						},
					];
				return [];
			});
			return content.length
				? [{ ...message, content, stopReason: "stop" }]
				: [];
		})
	);
}

export class SideThread {
	readonly exchanges: Exchange[] = [];
	private controller: AbortController | undefined;
	private readonly sessionId = randomUUID();
	onChange = () => {};

	get running() {
		return this.controller !== undefined;
	}

	ask(question: string, ctx: ExtensionContext): Promise<void> {
		if (this.running)
			throw new Error("A side question is already running.");
		const model = ctx.model;
		if (!model)
			throw new Error("Select a model before asking a side question.");
		const messages = conversationSnapshot(ctx);
		for (const exchange of this.exchanges
			.filter((item) => item.state === "complete")
			.slice(-20)) {
			messages.push({
				role: "user",
				content: exchange.question,
				timestamp: Date.now(),
			});
			messages.push({
				role: "assistant",
				content: [{ type: "text", text: exchange.answer }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
			});
		}
		messages.push({
			role: "user",
			content: question,
			timestamp: Date.now(),
		});
		const exchange: Exchange = { question, answer: "", state: "streaming" };
		this.exchanges.push(exchange);
		if (this.exchanges.length > 20) this.exchanges.shift();
		const controller = new AbortController();
		this.controller = controller;
		this.onChange();
		return this.generate(
			ctx,
			{ systemPrompt: SYSTEM_PROMPT, messages, tools: [] },
			exchange,
			controller
		);
	}

	private async generate(
		ctx: ExtensionContext,
		context: Context,
		exchange: Exchange,
		controller: AbortController
	) {
		try {
			const model = ctx.model;
			if (!model) throw new Error("No model selected.");
			const stream = ctx.modelRegistry.streamSimple(model, context, {
				// Never use ctx.signal: Escape on the main task must not cancel this request.
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(300_000),
				]),
				sessionId: this.sessionId,
				maxTokens: Math.min(4096, model.maxTokens),
				toolChoice: "none",
			});
			for await (const event of stream) {
				if (controller.signal.aborted) return;
				if (event.type === "text_delta") {
					exchange.answer += event.delta;
					this.onChange();
				}
			}
			const result = await stream.result();
			if (controller.signal.aborted) return;
			if (
				result.stopReason === "error" ||
				result.stopReason === "aborted"
			) {
				throw new Error(
					result.errorMessage ||
						"The side question was cancelled or timed out."
				);
			}
			exchange.answer = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (result.content.some((block) => block.type === "toolCall")) {
				exchange.answer +=
					"\n\n[No tools were executed. Side questions have no tool access.]";
			}
			if (!exchange.answer)
				exchange.answer = "The model returned no text answer.";
			if (result.stopReason === "length")
				exchange.answer +=
					"\n\n[Answer reached the output limit. Type a follow-up in the input below.]";
			exchange.state = "complete";
		} catch (error) {
			if (controller.signal.aborted) return;
			exchange.answer =
				error instanceof Error ? error.message : String(error);
			exchange.state = "error";
		} finally {
			if (this.controller === controller) {
				this.controller = undefined;
				this.onChange();
			}
		}
	}

	clear() {
		this.controller?.abort();
		this.controller = undefined;
		this.exchanges.length = 0;
		this.onChange();
	}
}
