/** Combines setup and conversation analysis into the single structure the renderer reads. */
import { calibrate } from "./calibrate.ts";
import { analyzeConversation, type Block, type Conversation, type Slot, type Turn } from "./conversation.ts";
import { deriveFindings, type Finding } from "./findings.ts";
import { analyzeSetup, type SetupItem, type SetupKind } from "./setup.ts";
import type { Snapshot } from "./snapshot.ts";
import { groupBy, sum, type Rates } from "./units.ts";

export interface Category {
	label: string;
	chars: number;
}

export interface SourceCost {
	origin: string;
	chars: number;
	counts: Map<SetupKind, number>;
}

export interface ToolResultStat {
	tool: string;
	count: number;
	chars: number;
	largest: number;
}

export interface Repeat {
	label: string;
	count: number;
	chars: number;
}

export interface Jump {
	turn: number;
	deltaTokens: number;
	promptTokens: number;
	culprits: Block[];
}

/**
 * Sizes stay in characters; `rates` converts them. Setup items, sources, and setup categories use
 * `rates.setup`; everything derived from the conversation uses `rates.conversation`.
 */
export interface Report {
	model: string;
	contextWindow: number | null;
	measuredTokens: number | null;
	/** Whether `rates` were fitted to the provider's count rather than assumed. */
	calibrated: boolean;
	rates: Rates;
	/** Setup plus conversation priced with `rates`; equals `measuredTokens` when calibrated. */
	totalTokens: number;
	undeclaredTools: number;
	setupChars: number;
	conversationChars: number;
	thinkingChars: number;
	/** Unpriced opaque reasoning payloads; see `Conversation.signatureChars`. */
	signatureChars: number;
	setupCategories: Category[];
	conversationCategories: Category[];
	setup: SetupItem[];
	sources: SourceCost[];
	conversation: Conversation;
	toolResults: ToolResultStat[];
	repeats: Repeat[];
	injected: Category[];
	biggest: Block[];
	jumps: Jump[];
	findings: Finding[];
}

const SETUP_LABELS: Record<SetupKind, string> = {
	core: "Pi core prompt",
	tool: "Tool declarations",
	skill: "Skills list",
	"context-file": "Context files (AGENTS.md…)",
	section: "Extension prompt sections",
};

const MIN_JUMP_TOKENS = 1000;
const MIN_REPEAT_CHARS = 4000;

function slotLabel(slot: Slot): string {
	switch (slot.kind) {
		case "user":
			return "Your messages";
		case "reply":
			return "Assistant replies";
		case "thinking":
			return "Thinking";
		case "tool-call":
			return "Tool calls (arguments)";
		case "tool-result":
			return "Tool results";
		case "bash":
			return "! bash output";
		case "injected":
			return "Extension-injected messages";
		case "summary":
			return slot.source === "compaction" ? "Compaction summary" : "Branch summary";
		case "other":
			return `Other (${slot.role})`;
	}
}

function categorize<T>(items: readonly T[], label: (item: T) => string, chars: (item: T) => number): Category[] {
	return [...groupBy(items, label)]
		.map(([name, group]) => ({ label: name, chars: sum(group, chars) }))
		.filter((c) => c.chars > 0)
		.sort((a, b) => b.chars - a.chars);
}

function bySource(setup: readonly SetupItem[]): SourceCost[] {
	return [...groupBy(setup, (item) => item.origin)]
		.map(([origin, items]) => {
			const counts: SourceCost["counts"] = new Map();
			for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
			return { origin, chars: sum(items, (i) => i.chars), counts };
		})
		.sort((a, b) => b.chars - a.chars);
}

function toolResultStats(blocks: readonly Block[]): ToolResultStat[] {
	const results = blocks.filter((b) => b.slot.kind === "tool-result");
	return [...groupBy(results, (b) => (b.slot.kind === "tool-result" ? b.slot.tool : ""))]
		.map(([tool, group]) => ({
			tool,
			count: group.length,
			chars: sum(group, (b) => b.chars),
			largest: Math.max(...group.map((b) => b.chars)),
		}))
		.sort((a, b) => b.chars - a.chars);
}

/** The same call (tool + arguments) answered more than once keeps every copy in context. */
function repeatedCalls(blocks: readonly Block[]): Repeat[] {
	const results = blocks.filter((b) => b.slot.kind === "tool-result" && b.callKey);
	return [...groupBy(results, (b) => b.callKey ?? "")]
		.filter(([, group]) => group.length > 1 && sum(group, (b) => b.chars) >= MIN_REPEAT_CHARS)
		.map(([, group]) => ({ label: group[0].label, count: group.length, chars: sum(group, (b) => b.chars) }))
		.sort((a, b) => b.chars - a.chars);
}

/** Measured growth between consecutive requests, attributed to the blocks that arrived in between. */
function growthJumps(turns: readonly Turn[]): Jump[] {
	const jumps: Jump[] = [];
	for (let i = 1; i < turns.length; i++) {
		const before = turns[i - 1].promptTokens;
		const after = turns[i].promptTokens;
		if (before === null || after === null || after - before < MIN_JUMP_TOKENS) continue;
		const culprits = [...turns[i].arrived].sort((a, b) => b.chars - a.chars).slice(0, 3);
		jumps.push({ turn: turns[i].index, deltaTokens: after - before, promptTokens: after, culprits });
	}
	return jumps.sort((a, b) => b.deltaTokens - a.deltaTokens).slice(0, 5);
}

export function buildReport(snapshot: Snapshot): Report {
	const setup = analyzeSetup(snapshot);
	const conversation = analyzeConversation(snapshot.messages);
	const { blocks } = conversation;
	const setupChars = sum(setup, (i) => i.chars);
	const conversationChars = sum(blocks, (b) => b.chars);
	const { rates, measured } = calibrate({
		measuredTokens: snapshot.measuredTokens,
		setupChars,
		conversation,
		conversationChars,
	});

	const report: Omit<Report, "findings"> = {
		model: snapshot.model,
		contextWindow: snapshot.contextWindow,
		measuredTokens: snapshot.measuredTokens,
		calibrated: measured,
		rates,
		totalTokens: setupChars * rates.setup + conversationChars * rates.conversation,
		undeclaredTools: snapshot.undeclaredToolCount,
		setupChars,
		conversationChars,
		signatureChars: conversation.signatureChars,
		thinkingChars: sum(blocks.filter((b) => b.slot.kind === "thinking"), (b) => b.chars),
		setupCategories: categorize(setup, (i) => SETUP_LABELS[i.kind], (i) => i.chars),
		conversationCategories: categorize(blocks, (b) => slotLabel(b.slot), (b) => b.chars),
		setup,
		sources: bySource(setup),
		conversation,
		toolResults: toolResultStats(blocks),
		repeats: repeatedCalls(blocks),
		injected: categorize(
			blocks.filter((b) => b.slot.kind === "injected"),
			(b) => (b.slot.kind === "injected" ? b.slot.customType : ""),
			(b) => b.chars,
		),
		biggest: [...blocks].sort((a, b) => b.chars - a.chars).slice(0, 10),
		jumps: growthJumps(conversation.turns),
	};
	return { ...report, findings: deriveFindings(report) };
}
