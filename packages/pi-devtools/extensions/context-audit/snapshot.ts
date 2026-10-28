/**
 * The boundary: everything the audit knows about Pi comes through `collectSnapshot`.
 * Analysis modules only ever see this plain, already-validated shape.
 */
import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
	ExtensionCommandContext,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ContextMessage {
	entryId: string;
	message: AgentMessage;
}

export interface Snapshot {
	model: string;
	/** Null when the model's window is unknown. */
	contextWindow: number | null;
	/** Provider-reported context size; null before the first reply and right after compaction. */
	measuredTokens: number | null;
	/** The prompt exactly as the next request will render it. */
	systemPrompt: string;
	options: BuildSystemPromptOptions;
	/** Tools whose declarations the model receives (active and not hidden). */
	declaredTools: ToolInfo[];
	/** Registered tools the model does not currently see. */
	undeclaredToolCount: number;
	/** What the model receives: compaction applied and context edits resolved, one element per message. */
	messages: ContextMessage[];
}

export function collectSnapshot(pi: ExtensionAPI, ctx: ExtensionCommandContext): Snapshot {
	const options = ctx.getSystemPromptOptions();
	const usage = ctx.getContextUsage();
	const active = new Set(pi.getActiveTools());
	const hidden = new Set(options.hiddenTools ?? []);
	const allTools = pi.getAllTools();
	const declaredTools = allTools.filter((tool) => active.has(tool.name) && !hidden.has(tool.name));

	const messages: ContextMessage[] = [];
	for (const { sourceEntry, messages: projected } of ctx.sessionManager.buildSessionProjection().entries) {
		for (const message of projected) messages.push({ entryId: sourceEntry.id, message });
	}

	return {
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model",
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
		// Pi reports 0 until the first reply, which is not a measurement.
		measuredTokens: usage?.tokens ? usage.tokens : null,
		systemPrompt: ctx.getSystemPrompt(),
		options,
		declaredTools,
		undeclaredToolCount: allTools.length - declaredTools.length,
		messages,
	};
}
