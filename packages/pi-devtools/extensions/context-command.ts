/**
 * /context - detailed context usage report.
 *
 * Shows startup context (system prompt, tools, context files, skills) and, once a
 * conversation exists, every LLM-facing entry with content-block breakdown.
 * Counts are chars/4 estimates except when the active provider has reported
 * aggregate usage via ctx.getContextUsage().
 *
 * Subcommands: help | prompt [full] | memory [substr] | tools | json
 * Overlay content is never added to the model context.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type AnyRecord = Record<string, any>;

type Item = {
	label: string;
	tokens: number;
	chars?: number;
	detail?: string;
	kind?: string;
	id?: string;
};

type ContextReport = {
	model: string;
	limit: number;
	total: number;
	free: number;
	measuredTokens: number | null;
	measuredPercent: number | null;
	estimateNote: string;
	sessionFile?: string;
	mode: "startup" | "conversation";
	categories: Item[];
	startup: {
		system: Item[];
		tools: Item[];
		memory: Item[];
		skills: Record<string, Item[]>;
	};
	conversation: {
		entries: number;
		branchMessages: number;
		excludedByCompaction: number;
		byRole: Item[];
		byBlockKind: Item[];
		toolCalls: Item[];
		entriesDetail: Item[];
		compaction?: Item;
	};
};

const TOKEN_DIVISOR = 4;
const PREVIEW_CHARS = 120;
const DUMP_DISPLAY_CAP = 200_000;
// Cap serialized tool-call args kept in previewable block text (full size still counted).
const TOOL_ARGS_TEXT_CAP = 2_000;
// Bound user-supplied memory path substrings (DoS / noisy notify strings).
const MEMORY_SUBSTR_CAP = 200;
const SUBCOMMANDS = ["help", "prompt", "memory", "tools", "json"] as const;

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}

function asText(value: unknown): string {
	if (value == null) return "";
	return typeof value === "string" ? value : safeStringify(value);
}

function estimateTokensFromChars(chars: number): number {
	return Math.max(0, Math.ceil(chars / TOKEN_DIVISOR));
}

function estimateTokens(value: unknown): number {
	if (value == null) return 0;
	return estimateTokensFromChars(asText(value).length);
}

function textLength(value: unknown): number {
	if (value == null) return 0;
	return asText(value).length;
}

function fmt(n: number): string {
	if (n < 20 && n > 0) return "<20";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

function pct(tokens: number, limit: number): string {
	if (!limit) return "0%";
	const p = (tokens / limit) * 100;
	return p < 0.1 && tokens > 0 ? "<0.1%" : `${p.toFixed(1)}%`;
}

function compactPath(file: string): string {
	const home = process.env.HOME;
	return home && file.startsWith(home) ? file.replace(home, "~") : file;
}

function firstLine(value: unknown): string {
	const text = asText(value ?? "");
	return text.replace(/\s+/g, " ").trim();
}

function shortId(id: unknown): string {
	if (typeof id !== "string" || !id) return "";
	return id.length <= 8 ? id : id.slice(0, 8);
}

type ContentBlock = {
	kind: string;
	/** Previewable / display text. May be capped for large payloads. */
	text: string;
	/** Exact char count for token estimates when `text` is capped/redacted. */
	tokenChars?: number;
};

function blockCharCount(block: ContentBlock): number {
	return block.tokenChars ?? block.text.length;
}

function blocksCharCount(blocks: ContentBlock[]): number {
	return blocks.reduce((sum, block) => sum + blockCharCount(block), 0);
}

function contentBlocks(content: unknown): ContentBlock[] {
	if (typeof content === "string") {
		return content ? [{ kind: "text", text: content }] : [];
	}
	if (!Array.isArray(content)) {
		if (content == null) return [];
		const text = firstLine(content);
		return text ? [{ kind: "other", text }] : [];
	}
	const blocks: ContentBlock[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ kind: "text", text: block.text });
		} else if (block.type === "thinking" && typeof block.thinking === "string") {
			blocks.push({ kind: "thinking", text: block.thinking });
		} else if (block.type === "toolCall") {
			const name = typeof block.name === "string" && block.name ? block.name : "tool";
			const argsJson = safeStringify(block.arguments ?? {});
			const tokenChars = name.length + 1 + argsJson.length;
			// Keep preview text bounded so multi-MB tool args never join into report strings.
			const argsText =
				argsJson.length > TOOL_ARGS_TEXT_CAP
					? `${argsJson.slice(0, TOOL_ARGS_TEXT_CAP)}…[+${argsJson.length - TOOL_ARGS_TEXT_CAP} chars]`
					: argsJson;
			blocks.push({
				kind: "toolCall",
				text: `${name} ${argsText}`,
				tokenChars,
			});
		} else if (block.type === "image") {
			// Never materialize multi-MB base64 into preview/join paths.
			// Count full payload length for estimates; show a size placeholder only.
			if (typeof block.data === "string" && block.data.length > 0) {
				const n = block.data.length;
				blocks.push({
					kind: "image",
					text: `[image data ${n} chars]`,
					tokenChars: n,
				});
			} else if (typeof block.url === "string" && block.url.length > 0) {
				const url = block.url;
				const preview =
					url.length > PREVIEW_CHARS ? `${url.slice(0, PREVIEW_CHARS)}…` : url;
				blocks.push({ kind: "image", text: preview, tokenChars: url.length });
			} else {
				blocks.push({ kind: "image", text: "[image]" });
			}
		} else {
			blocks.push({ kind: "other", text: firstLine(block) });
		}
	}
	return blocks;
}

function contentCharCount(content: unknown): number {
	return blocksCharCount(contentBlocks(content));
}

function messageTokens(message: AnyRecord): number {
	if (message.role === "toolResult") {
		const name = typeof message.toolName === "string" ? message.toolName : "toolResult";
		return estimateTokensFromChars(name.length + 1 + contentCharCount(message.content));
	}
	return estimateTokensFromChars(contentCharCount(message.content ?? message));
}

function messageChars(message: AnyRecord): number {
	if (message.role === "toolResult") {
		const name = typeof message.toolName === "string" ? message.toolName : "toolResult";
		return name.length + 1 + contentCharCount(message.content);
	}
	return contentCharCount(message.content ?? message);
}

function messageRole(entry: AnyRecord): string | undefined {
	return entry?.message?.role;
}

function selectedToolNames(options: AnyRecord, pi: ExtensionAPI): Set<string> {
	const selected = Array.isArray(options.selectedTools) ? options.selectedTools : [];
	if (selected.length === 0) {
		return new Set(pi.getActiveTools().map((t: any) => (typeof t === "string" ? t : t.name)));
	}
	return new Set(selected.map((t: any) => (typeof t === "string" ? t : t.name)).filter(Boolean));
}

function subtractKnown(systemPrompt: string, known: string[]): number {
	let remaining = systemPrompt;
	for (const part of known.filter(Boolean).sort((a, b) => b.length - a.length)) {
		remaining = remaining.replace(part, "");
	}
	return estimateTokens(remaining);
}

function pushCount(map: Map<string, number>, key: string, tokens: number) {
	map.set(key, (map.get(key) ?? 0) + tokens);
}

function sortByTokens(items: Item[]): Item[] {
	return [...items].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}

function blockSummary(blocks: ContentBlock[]): string {
	if (blocks.length === 0) return "empty";
	const counts = new Map<string, number>();
	for (const b of blocks) pushCount(counts, b.kind, 1);
	return [...counts.entries()].map(([k, n]) => `${k}×${n}`).join(" ");
}

/** First-line preview from block text only - never joins full multi-MB payloads. */
function contentPreview(blocks: ContentBlock[], max = PREVIEW_CHARS): string {
	if (blocks.length === 0) return "";
	const budget = Math.max(max * 4, max);
	let acc = "";
	for (const block of blocks) {
		if (acc.length >= budget) break;
		const piece = block.text.slice(0, budget - acc.length + 1);
		acc = acc ? `${acc} ${piece}` : piece;
	}
	return acc.replace(/\s+/g, " ").trim().slice(0, max);
}

function buildReport(pi: ExtensionAPI, ctx: any): ContextReport {
	const options = ctx.getSystemPromptOptions?.() ?? {};
	const usage = ctx.getContextUsage?.();
	const limit = usage?.contextWindow ?? ctx.model?.contextWindow ?? 128_000;
	const measuredTokens = usage && typeof usage.tokens === "number" ? usage.tokens : null;
	const measuredPercent = usage && typeof usage.percent === "number" ? usage.percent : null;
	const model = ctx.model?.id ?? "unknown model";
	const systemPrompt = ctx.getSystemPrompt?.() ?? "";
	const sessionFileRaw = ctx.sessionManager?.getSessionFile?.();
	const sessionFile = typeof sessionFileRaw === "string" ? compactPath(sessionFileRaw) : undefined;

	const skills = Array.isArray(options.skills) ? options.skills : [];
	const skillItems: Item[] = skills.map((skill: AnyRecord) => {
		// Prompt embeds name + description (+ location XML); estimate from name/description only.
		const text = `${skill.name ?? ""}\n${skill.description ?? ""}`;
		return {
			label: skill.name ?? "unknown",
			tokens: estimateTokens(text),
			chars: text.length,
			detail: compactPath(skill.filePath ?? skill.sourceInfo?.path ?? ""),
			kind: skill.sourceInfo?.scope ?? "skills",
		};
	});
	const skillsByScope: Record<string, Item[]> = {};
	for (const item of skillItems) {
		const scope = item.kind ?? "skills";
		(skillsByScope[scope] ??= []).push(item);
	}
	for (const scope of Object.keys(skillsByScope)) {
		skillsByScope[scope] = sortByTokens(skillsByScope[scope]);
	}

	const contextFiles = Array.isArray(options.contextFiles) ? options.contextFiles : [];
	const memoryItems: Item[] = sortByTokens(
		contextFiles.map((file: AnyRecord) => {
			const content = file.content ?? file.text ?? "";
			return {
				label: compactPath(file.path ?? file.filePath ?? "context file"),
				tokens: estimateTokens(content),
				chars: textLength(content),
			};
		}),
	);

	const selected = selectedToolNames(options, pi);
	const allTools = pi.getAllTools();
	const toolItems: Item[] = sortByTokens(
		allTools
			.filter((tool: AnyRecord) => selected.size === 0 || selected.has(tool.name))
			.map((tool: AnyRecord) => {
				const text = [
					tool.name,
					tool.description,
					...(Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines : []),
				]
					.filter(Boolean)
					.join("\n");
				return {
					label: tool.name,
					// Match the prompt-facing footprint, not the full JSON schema object.
					tokens: estimateTokens(text),
					chars: text.length,
					detail: tool.sourceInfo?.source ?? "tool",
				};
			}),
	);

	const knownPromptParts = [
		...skills.map((s: AnyRecord) => `${s.name ?? ""}\n${s.description ?? ""}`),
		...skills.map((s: AnyRecord) => s.description ?? ""),
		...contextFiles.map((f: AnyRecord) => f.content ?? f.text ?? ""),
		...(Array.isArray(options.promptGuidelines) ? options.promptGuidelines : []),
		options.customPrompt,
		options.appendSystemPrompt,
	].filter((v): v is string => typeof v === "string" && v.length > 0);

	const promptGuidelinesText = Array.isArray(options.promptGuidelines)
		? options.promptGuidelines.join("\n")
		: "";
	const customPromptText = [options.customPrompt, options.appendSystemPrompt].filter(Boolean).join("\n");
	const promptGuidelinesTokens = estimateTokens(promptGuidelinesText);
	const customPromptTokens = estimateTokens(customPromptText);
	const systemBaseTokens = Math.max(
		estimateTokens(systemPrompt) ? 1 : 0,
		subtractKnown(systemPrompt, knownPromptParts),
	);
	const systemItems = [
		// chars omitted for base remainder - tokens are after subtractKnown, not full prompt length
		{ label: "Pi system prompt", tokens: systemBaseTokens },
		{ label: "Prompt guidelines", tokens: promptGuidelinesTokens, chars: promptGuidelinesText.length },
		{ label: "Custom/append prompt", tokens: customPromptTokens, chars: customPromptText.length },
	].filter((item) => item.tokens > 0);

	const branch = ctx.sessionManager.getBranch?.() ?? [];
	const contextEntries = ctx.sessionManager.buildContextEntries?.() ?? branch;

	const roleTokens = new Map<string, number>();
	const blockKindTokens = new Map<string, number>();
	const toolCallTokens = new Map<string, number>();
	const entriesDetail: Item[] = [];
	let contextMessageEntries = 0;
	let conversationTokens = 0;
	let compactionItem: Item | undefined;

	let branchMessages = 0;
	for (const entry of branch) {
		if (entry.type === "message") branchMessages++;
	}

	let entryIndex = 0;
	for (const entry of contextEntries) {
		entryIndex++;
		const id = shortId(entry.id);

		if (entry.type === "compaction") {
			const summary = typeof entry.summary === "string" ? entry.summary : "";
			const tokens = estimateTokens(summary);
			const chars = summary.length;
			conversationTokens += tokens;
			pushCount(roleTokens, "compaction", tokens);
			pushCount(blockKindTokens, "text", tokens);
			compactionItem = {
				label: `compaction #${entryIndex}${id ? ` ${id}` : ""}`,
				tokens,
				chars,
				detail: `before ${fmt(entry.tokensBefore ?? 0)} · keep ${entry.firstKeptEntryId ?? "?"}`,
				id: typeof entry.id === "string" ? entry.id : undefined,
			};
			entriesDetail.push(compactionItem);
			continue;
		}

		if (entry.type === "branch_summary") {
			const summary = typeof entry.summary === "string" ? entry.summary : "";
			if (!summary) continue;
			const tokens = estimateTokens(summary);
			const chars = summary.length;
			conversationTokens += tokens;
			pushCount(roleTokens, "branch_summary", tokens);
			pushCount(blockKindTokens, "text", tokens);
			entriesDetail.push({
				label: `branch_summary #${entryIndex}${id ? ` ${id}` : ""}`,
				tokens,
				chars,
				detail: `from ${shortId(entry.fromId) || "?"} · ${firstLine(summary).slice(0, PREVIEW_CHARS)}`,
				id: typeof entry.id === "string" ? entry.id : undefined,
			});
			continue;
		}

		if (entry.type === "custom_message") {
			const content = entry.content;
			const blocks = contentBlocks(content);
			const chars = blocksCharCount(blocks);
			const tokens = estimateTokensFromChars(chars);
			conversationTokens += tokens;
			const role = `custom_message:${entry.customType ?? "custom"}`;
			pushCount(roleTokens, role, tokens);
			for (const block of blocks) {
				pushCount(blockKindTokens, block.kind, estimateTokensFromChars(blockCharCount(block)));
			}
			entriesDetail.push({
				label: `${role} #${entryIndex}${id ? ` ${id}` : ""}`,
				tokens,
				chars,
				detail: `${blockSummary(blocks)} · ${contentPreview(blocks)}`,
				id: typeof entry.id === "string" ? entry.id : undefined,
			});
			continue;
		}

		if (entry.type !== "message") continue;

		contextMessageEntries++;
		const role = messageRole(entry) ?? "message";
		const message = entry.message ?? {};
		const tokens = messageTokens(message);
		const chars = messageChars(message);
		conversationTokens += tokens;
		pushCount(roleTokens, role, tokens);

		let blocks: ContentBlock[] = [];
		if (role === "toolResult") {
			// Preview uses capped block text; tokenChars keeps full result size.
			const name = typeof message.toolName === "string" ? message.toolName : "toolResult";
			const resultBlocks = contentBlocks(message.content);
			const preview = contentPreview(resultBlocks);
			blocks = [
				{
					kind: "toolResult",
					text: preview ? `${name} ${preview}` : name,
					tokenChars: chars,
				},
			];
			pushCount(blockKindTokens, "toolResult", tokens);
			if (message.toolName) {
				pushCount(toolCallTokens, `${message.toolName} result`, tokens);
			}
		} else {
			blocks = contentBlocks(message.content ?? message);
			for (const block of blocks) {
				pushCount(blockKindTokens, block.kind, estimateTokensFromChars(blockCharCount(block)));
			}
			if (role === "assistant" && Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block?.type === "toolCall" && block.name) {
						const name = String(block.name);
						const argsChars = asText(block.arguments ?? {}).length;
						pushCount(
							toolCallTokens,
							name,
							estimateTokensFromChars(argsChars + name.length),
						);
					}
				}
			}
		}

		const labelRole = role === "toolResult" && message.toolName ? `toolResult:${message.toolName}` : role;
		entriesDetail.push({
			label: `${labelRole} #${entryIndex}${id ? ` ${id}` : ""}`,
			tokens,
			chars,
			detail: `${blockSummary(blocks)} · ${contentPreview(blocks)}`,
			id: typeof entry.id === "string" ? entry.id : undefined,
		});
	}

	const excludedByCompaction = Math.max(0, branchMessages - contextMessageEntries);

	const startupSystem = systemItems.reduce((sum, item) => sum + item.tokens, 0);
	const startupTools = toolItems.reduce((sum, item) => sum + item.tokens, 0);
	const startupMemory = memoryItems.reduce((sum, item) => sum + item.tokens, 0);
	const startupSkills = skillItems.reduce((sum, item) => sum + item.tokens, 0);
	const compactionTokens = compactionItem?.tokens ?? 0;
	const startupTokens = startupSystem + startupTools + startupMemory + startupSkills;
	const estimatedTotal = startupTokens + conversationTokens;
	const total = measuredTokens != null ? Math.max(measuredTokens, estimatedTotal) : estimatedTotal;
	const other = measuredTokens != null ? Math.max(0, measuredTokens - estimatedTotal) : 0;
	const free = Math.max(0, limit - total);

	const hasConversation = contextMessageEntries > 0 || !!compactionItem || entriesDetail.length > 0;

	const categories: Item[] = [
		{ label: "System prompt", tokens: startupSystem },
		{ label: "System tools", tokens: startupTools, detail: `${toolItems.length} active` },
		{ label: "Memory files", tokens: startupMemory, detail: `${memoryItems.length} files` },
		{ label: "Skills", tokens: startupSkills, detail: `${skillItems.length} loaded` },
		{
			label: "Context messages",
			tokens: Math.max(0, conversationTokens - compactionTokens),
			detail: `${contextMessageEntries} entries`,
		},
	];
	if (compactionItem) {
		categories.push({
			label: "Compaction summary",
			tokens: compactionTokens,
			detail: compactionItem.detail,
		});
	}
	categories.push(
		{ label: "Provider/other", tokens: other },
		{ label: "Free space", tokens: free },
	);

	return {
		model,
		limit,
		total,
		free,
		measuredTokens,
		measuredPercent,
		estimateNote: "chars/4 estimate",
		sessionFile,
		mode: hasConversation ? "conversation" : "startup",
		categories,
		startup: {
			system: systemItems,
			tools: toolItems,
			memory: memoryItems,
			skills: skillsByScope,
		},
		conversation: {
			entries: contextMessageEntries,
			branchMessages,
			excludedByCompaction,
			byRole: [...roleTokens.entries()]
				.map(([label, tokens]) => ({ label, tokens }))
				.sort((a, b) => b.tokens - a.tokens),
			byBlockKind: [...blockKindTokens.entries()]
				.map(([label, tokens]) => ({ label, tokens }))
				.sort((a, b) => b.tokens - a.tokens),
			toolCalls: [...toolCallTokens.entries()]
				.map(([label, tokens]) => ({ label, tokens }))
				.sort((a, b) => b.tokens - a.tokens),
			entriesDetail,
			compaction: compactionItem,
		},
	};
}

function headerUsageLine(report: ContextReport): string {
	const measured =
		report.measuredTokens != null ? fmt(report.measuredTokens) : "?";
	const measuredPct =
		report.measuredTokens != null
			? report.measuredPercent != null
				? `${report.measuredPercent.toFixed(1)}%`
				: pct(report.measuredTokens, report.limit)
			: null;
	const pctPart = measuredPct != null ? ` (${measuredPct})` : "";
	return `est ${fmt(report.total)} · provider ${measured} / ${fmt(report.limit)}${pctPart} · free ${fmt(report.free)} · mode ${report.mode}`;
}

function plainReport(report: ContextReport): string {
	const lines: string[] = [];
	lines.push(`Context Usage - ${report.model}`);
	lines.push(headerUsageLine(report));
	lines.push(`Note: ${report.estimateNote}`);
	if (report.sessionFile) lines.push(`Session: ${report.sessionFile}`);
	lines.push("");
	lines.push("Breakdown");
	for (const item of report.categories) {
		lines.push(
			`  ${item.label}: ${fmt(item.tokens)} (${pct(item.tokens, report.limit)})${item.detail ? ` · ${item.detail}` : ""}`,
		);
	}
	lines.push("");
	lines.push("Startup context");
	for (const item of report.startup.system) {
		lines.push(
			`  ${item.label}: ${fmt(item.tokens)}${item.chars != null ? ` · ${item.chars} chars` : ""}`,
		);
	}
	if (report.startup.memory.length) {
		lines.push(`  Memory files · ${report.startup.memory.length}`);
		for (const item of report.startup.memory) {
			lines.push(
				`    ${item.label}: ${fmt(item.tokens)}${item.chars != null ? ` · ${item.chars} chars` : ""}`,
			);
		}
	}
	if (report.startup.tools.length) {
		lines.push(`  System tools · ${report.startup.tools.length}`);
		for (const item of report.startup.tools) {
			lines.push(
				`    ${item.label}: ${fmt(item.tokens)}${item.detail ? ` · ${item.detail}` : ""}`,
			);
		}
	}
	for (const [scope, items] of Object.entries(report.startup.skills)) {
		lines.push(`  Skills · ${scope} · ${items.length}`);
		for (const item of items) {
			lines.push(
				`    ${item.label}: ${fmt(item.tokens)}${item.detail ? ` · ${item.detail}` : ""}`,
			);
		}
	}
	if (report.mode === "conversation") {
		lines.push("");
		const excl =
			report.conversation.excludedByCompaction > 0
				? ` · ${report.conversation.excludedByCompaction} branch messages excluded by compaction`
				: "";
		lines.push(
			`Conversation · ${report.conversation.entries} context messages · ${report.conversation.branchMessages} branch messages${excl}`,
		);
		if (report.conversation.compaction) {
			const c = report.conversation.compaction;
			lines.push(`  ${c.label}: ${fmt(c.tokens)}${c.detail ? ` · ${c.detail}` : ""}`);
		}
		lines.push("  By role");
		for (const item of report.conversation.byRole) {
			lines.push(`    ${item.label}: ${fmt(item.tokens)}`);
		}
		if (report.conversation.byBlockKind.length) {
			lines.push("  By content block");
			for (const item of report.conversation.byBlockKind) {
				lines.push(`    ${item.label}: ${fmt(item.tokens)}`);
			}
		}
		if (report.conversation.toolCalls.length) {
			lines.push("  Tool calls/results");
			for (const item of report.conversation.toolCalls) {
				lines.push(`    ${item.label}: ${fmt(item.tokens)}`);
			}
		}
		lines.push("  Context entries");
		for (const item of report.conversation.entriesDetail) {
			lines.push(
				`    ${item.label}: ${fmt(item.tokens)}${item.chars != null ? ` · ${item.chars} chars` : ""}${item.detail ? ` · ${item.detail}` : ""}`,
			);
		}
	}
	return lines.join("\n");
}

function renderReport(report: ContextReport, theme: any, width: number): string[] {
	const barWidth = Math.max(12, Math.min(28, Math.floor(width / 4)));
	const ratio = report.limit ? report.total / report.limit : 0;
	const usedCells = Math.max(0, Math.min(barWidth, Math.round(ratio * barWidth)));
	const bar = `${"█".repeat(usedCells)}${"░".repeat(barWidth - usedCells)}`;
	const barColor = ratio > 0.8 ? "error" : ratio > 0.5 ? "warning" : "success";
	const lines: string[] = [];
	const add = (line = "") => lines.push(line);
	const item = (prefix: string, row: Item) => {
		const amount = `${fmt(row.tokens)} (${pct(row.tokens, report.limit)})`;
		const chars = row.chars != null ? ` ${theme.fg("dim", `· ${row.chars}c`)}` : "";
		const detail = row.detail ? ` ${theme.fg("dim", "· " + row.detail)}` : "";
		add(
			`${theme.fg("dim", prefix)} ${theme.fg("text", row.label)} ${theme.fg("dim", "·")} ${theme.fg("accent", amount)}${chars}${detail}`,
		);
	};

	add(`${theme.fg("accent", theme.bold("Context Usage"))} ${theme.fg("dim", "·")} ${theme.fg("text", report.model)}`);
	add(
		`${theme.fg(barColor, bar)} ${theme.fg("text", headerUsageLine(report))}`,
	);
	add(theme.fg("dim", report.estimateNote));
	if (report.sessionFile) add(theme.fg("dim", `Session ${report.sessionFile}`));
	add("");
	add(theme.fg("dim", "Estimated usage by category"));
	for (const row of report.categories) item("├", row);
	add("");
	add(
		`${theme.fg("accent", "Startup context")} ${theme.fg("dim", report.mode === "startup" ? "before first message" : "base payload")}`,
	);
	for (const row of report.startup.system) item("├", row);
	if (report.startup.memory.length) {
		add(theme.fg("dim", `├ Memory files · ${report.startup.memory.length}`));
		for (const row of report.startup.memory) item("│ ├", row);
	}
	if (report.startup.tools.length) {
		add(theme.fg("dim", `├ System tools · ${report.startup.tools.length}`));
		for (const row of report.startup.tools) item("│ ├", row);
	}
	for (const [scope, rows] of Object.entries(report.startup.skills)) {
		add(theme.fg("dim", `├ Skills · ${scope} · ${rows.length}`));
		for (const row of rows) item("│ ├", row);
	}
	if (report.mode === "conversation") {
		add("");
		const excl =
			report.conversation.excludedByCompaction > 0
				? ` · ${report.conversation.excludedByCompaction} excluded by compaction`
				: "";
		add(
			`${theme.fg("accent", "Conversation")} ${theme.fg("dim", `${report.conversation.entries} context msgs · ${report.conversation.branchMessages} branch${excl}`)}`,
		);
		if (report.conversation.compaction) item("├", report.conversation.compaction);
		for (const row of report.conversation.byRole) item("├", row);
		if (report.conversation.byBlockKind.length) {
			add(theme.fg("dim", "├ Content blocks"));
			for (const row of report.conversation.byBlockKind) item("│ ├", row);
		}
		if (report.conversation.toolCalls.length) {
			add(theme.fg("dim", "├ Tool calls/results"));
			for (const row of report.conversation.toolCalls) item("│ ├", row);
		}
		if (report.conversation.entriesDetail.length) {
			add(theme.fg("dim", `├ Context entries · ${report.conversation.entriesDetail.length}`));
			for (const row of report.conversation.entriesDetail) item("│ ├", row);
		}
	}

	return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line));
}

function helpText(): string {
	return [
		"Usage: /context [subcommand]",
		"",
		"  (none)              Full detailed context usage report",
		"  help                This help",
		"  prompt              System prompt size (chars / tokens / lines)",
		"  prompt full         Dump full system prompt text",
		"  memory              List memory/context files with sizes",
		"  memory <substr>     Dump first context file whose path contains substr",
		"  tools               List active tools and prompt footprint",
		"  json                Structured report JSON (no full bodies)",
		"",
		"Estimates use chars/4 unless the provider reported usage.",
		"Report / dump content is not added to the model context.",
		"",
		"TUI: on /context prompt, press e or space to expand/collapse the body.",
		"",
		"Security note:",
		"  Default prompt view is size metadata only.",
		"  Expanded prompt and memory dumps may contain secrets, tokens, or PII",
		"  from system prompts and context files. Prefer json for shareable reports.",
		"  Large dumps are truncated for display; do not paste dumps into chats",
		"  or tickets without reviewing them first.",
	].join("\n");
}

function reportToJson(report: ContextReport): string {
	// Ids, labels, tokens, paths only - no memory/system bodies, no entry previews.
	const scrub = (item: Item, opts?: { dropDetail?: boolean }): Item => ({
		label: item.label,
		tokens: item.tokens,
		...(item.chars != null ? { chars: item.chars } : {}),
		...(item.kind ? { kind: item.kind } : {}),
		...(item.id ? { id: item.id } : {}),
		...(!opts?.dropDetail && item.detail ? { detail: item.detail } : {}),
	});
	const scrubList = (items: Item[], opts?: { dropDetail?: boolean }) =>
		items.map((item) => scrub(item, opts));
	const payload = {
		model: report.model,
		limit: report.limit,
		total: report.total,
		free: report.free,
		measuredTokens: report.measuredTokens,
		measuredPercent: report.measuredPercent,
		estimateNote: report.estimateNote,
		sessionFile: report.sessionFile,
		mode: report.mode,
		categories: scrubList(report.categories),
		startup: {
			system: scrubList(report.startup.system),
			tools: scrubList(report.startup.tools),
			memory: scrubList(report.startup.memory),
			skills: Object.fromEntries(
				Object.entries(report.startup.skills).map(([scope, items]) => [scope, scrubList(items)]),
			),
		},
		conversation: {
			entries: report.conversation.entries,
			branchMessages: report.conversation.branchMessages,
			excludedByCompaction: report.conversation.excludedByCompaction,
			byRole: scrubList(report.conversation.byRole),
			byBlockKind: scrubList(report.conversation.byBlockKind),
			toolCalls: scrubList(report.conversation.toolCalls),
			entriesDetail: scrubList(report.conversation.entriesDetail, { dropDetail: true }),
			...(report.conversation.compaction
				? { compaction: scrub(report.conversation.compaction) }
				: {}),
		},
	};
	return JSON.stringify(payload, null, 2);
}

function capDump(body: string): { text: string; truncated: boolean; totalChars: number } {
	const totalChars = body.length;
	if (totalChars <= DUMP_DISPLAY_CAP) {
		return { text: body, truncated: false, totalChars };
	}
	return {
		text: `${body.slice(0, DUMP_DISPLAY_CAP)}\n\n… truncated for display; ${totalChars} chars total`,
		truncated: true,
		totalChars,
	};
}

type PromptStats = {
	chars: number;
	tokens: number;
	lines: number;
};

function promptStats(body: string): PromptStats {
	const chars = body.length;
	const tokens = estimateTokens(body);
	const lines = chars === 0 ? 0 : body.split("\n").length;
	return { chars, tokens, lines };
}

function formatPromptStats(stats: PromptStats): string {
	return `${stats.chars.toLocaleString()} chars · est ${fmt(stats.tokens)} tokens · ${stats.lines.toLocaleString()} lines`;
}

function formatPromptStatsPlain(title: string, body: string, expanded: boolean): string {
	const stats = promptStats(body);
	const header = `${title}\n${formatPromptStats(stats)}`;
	if (!expanded) return header;
	const capped = capDump(body);
	const note = capped.truncated ? "\n(display truncated)" : "";
	return `${header}${note}\n\n${capped.text}`;
}

async function showTextOverlay(title: string, body: string, ctx: any) {
	const capped = capDump(body);
	await ctx.ui.custom((_tui: any, theme: any, _kb: any, done: (value?: unknown) => void) => ({
		render(width: number): string[] {
			const box = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
			const header = [
				theme.fg("accent", theme.bold(title)),
				theme.fg(
					"dim",
					`${capped.totalChars} chars · est ${fmt(estimateTokens(body))} tokens${capped.truncated ? " · display truncated" : ""}`,
				),
				"",
			].join("\n");
			const footer = `\n${theme.fg("dim", "Esc/Enter to close · not added to model context")}`;
			const content = header + capped.text + footer;
			const lines = content.split("\n").map((line) =>
				visibleWidth(line) > width ? truncateToWidth(line, width) : line,
			);
			box.addChild(new Text(lines.join("\n"), 0, 0));
			return box.render(width);
		},
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
		},
	}));
}

async function showPromptOverlay(title: string, body: string, ctx: any, initiallyExpanded = false) {
	const stats = promptStats(body);
	let expanded = initiallyExpanded;
	await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value?: unknown) => void) => ({
		render(width: number): string[] {
			const box = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
			const headerLines = [
				theme.fg("accent", theme.bold(title)),
				theme.fg("dim", formatPromptStats(stats)),
			];
			let bodyText = "";
			if (expanded) {
				const capped = capDump(body);
				const truncateNote = capped.truncated
					? `\n${theme.fg("dim", "display truncated")}`
					: "";
				bodyText = `\n${truncateNote}\n${capped.text}`;
			}
			const expandHint = expanded ? "e/space collapse" : "e/space expand";
			const footer = `\n${theme.fg("dim", `${expandHint} · Esc/Enter close · not added to model context`)}`;
			const content = `${headerLines.join("\n")}${bodyText}${footer}`;
			const lines = content.split("\n").map((line) =>
				visibleWidth(line) > width ? truncateToWidth(line, width) : line,
			);
			box.addChild(new Text(lines.join("\n"), 0, 0));
			return box.render(width);
		},
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
				done(undefined);
				return;
			}
			if (matchesKey(data, "space") || data === "e" || data === "E") {
				expanded = !expanded;
				tui.requestRender();
			}
		},
	}));
}

async function presentPrompt(title: string, body: string, ctx: any, expanded: boolean) {
	const text = typeof body === "string" ? body : asText(body);
	if (ctx.mode === "print" || !ctx.hasUI) {
		console.log(formatPromptStatsPlain(title, text, expanded));
		return;
	}
	await showPromptOverlay(title, text, ctx, expanded);
}

async function showContextOverlay(report: ContextReport, ctx: any) {
	// overlay:false replaces the main viewport so the report fills the
	// screen, is scrollable (Ctrl+N/P), and disappears on Esc without
	// adding anything to the model context.
	await ctx.ui.custom((_tui: any, theme: any, _kb: any, done: (value?: unknown) => void) => ({
		render(width: number): string[] {
			const box = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
			const body = [
				...renderReport(report, theme, Math.max(20, width - 2)),
				"",
				theme.fg(
					"dim",
					"Esc/Enter to close · not added to model context · estimates = chars/4 unless provider measured",
				),
			].join("\n");
			box.addChild(new Text(body, 0, 0));
			return box.render(width);
		},
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
		},
	}));
}

async function presentText(title: string, body: string, ctx: any) {
	const text = typeof body === "string" ? body : asText(body);
	if (ctx.mode === "print" || !ctx.hasUI) {
		// Match overlay: never dump unbounded prompt/memory bodies to stdout.
		const capped = capDump(text);
		console.log(`${title}\n${capped.text}`);
		return;
	}
	// showTextOverlay applies DUMP_DISPLAY_CAP and reports original totalChars.
	await showTextOverlay(title, text, ctx);
}

function listMemoryFiles(ctx: any): Array<{ path: string; content: string; tokens: number; chars: number }> {
	const options = ctx.getSystemPromptOptions?.() ?? {};
	const contextFiles = Array.isArray(options.contextFiles) ? options.contextFiles : [];
	return contextFiles.map((file: AnyRecord) => {
		const path =
			typeof file.path === "string"
				? file.path
				: typeof file.filePath === "string"
					? file.filePath
					: "context file";
		// Only accept string bodies - never coerce objects via JSON into a dump surface.
		const content =
			typeof file.content === "string"
				? file.content
				: typeof file.text === "string"
					? file.text
					: "";
		return {
			path,
			content,
			tokens: estimateTokens(content),
			chars: content.length,
		};
	});
}

function listToolsDetail(pi: ExtensionAPI, ctx: any): string {
	const options = ctx.getSystemPromptOptions?.() ?? {};
	const selected = selectedToolNames(options, pi);
	const tools = pi.getAllTools().filter((tool: AnyRecord) => selected.size === 0 || selected.has(tool.name));
	const lines: string[] = [
		`Active tools · ${tools.length}`,
		"Note: estimate is prompt footprint (name + description + guidelines), not full JSON schema.",
		"",
	];
	const items = sortByTokens(
		tools.map((tool: AnyRecord) => {
			const text = [
				tool.name,
				tool.description,
				...(Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines : []),
			]
				.filter(Boolean)
				.join("\n");
			return {
				label: tool.name,
				tokens: estimateTokens(text),
				chars: text.length,
				detail: tool.sourceInfo?.source ?? "tool",
			};
		}),
	);
	for (const item of items) {
		lines.push(
			`  ${item.label}: ${fmt(item.tokens)} · ${item.chars} chars · ${item.detail ?? ""}`,
		);
	}
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description: "Show detailed context usage (prompt|memory|tools|json|help)",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.trim().split(/\s+/).filter(Boolean);
			const trailingSpace = /\s$/.test(prefix);
			// After "prompt " (with space), offer the full dump flag.
			if (parts[0]?.toLowerCase() === "prompt" && (parts.length >= 2 || trailingSpace)) {
				const partial = trailingSpace || parts.length < 2 ? "" : parts[1].toLowerCase();
				return ["full"]
					.filter((value) => value.startsWith(partial))
					.map((value) => ({ value, label: value }));
			}
			const p = (parts[0] ?? "").toLowerCase();
			const hits = SUBCOMMANDS.filter((x) => x.startsWith(p));
			return hits.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const raw = (args ?? "").trim();
			const [mode, ...rest] = raw.split(/\s+/).filter(Boolean);
			const sub = (mode ?? "").toLowerCase();

			if (sub === "help") {
				await presentText("Context help", helpText(), ctx);
				return;
			}

			if (sub === "prompt") {
				const flag = (rest[0] ?? "").toLowerCase();
				if (rest.length > 1 || (flag && flag !== "full")) {
					const shown = rest.join(" ");
					const msg = `Unknown prompt argument "${shown}".\n\nUse /context prompt or /context prompt full.`;
					if (ctx.mode === "print" || !ctx.hasUI) {
						console.log(msg);
					} else {
						ctx.ui.notify(`Unknown /context prompt argument: ${shown}`, "warning");
						await presentText("Context help", msg, ctx);
					}
					return;
				}
				const prompt = ctx.getSystemPrompt?.() ?? "";
				await presentPrompt("System prompt", prompt, ctx, flag === "full");
				return;
			}

			if (sub === "memory") {
				const files = listMemoryFiles(ctx);
				const substrRaw = rest.join(" ").trim();
				const substr =
					substrRaw.length > MEMORY_SUBSTR_CAP
						? substrRaw.slice(0, MEMORY_SUBSTR_CAP)
						: substrRaw;
				if (!substr) {
					const lines =
						files.length === 0
							? ["No context files loaded."]
							: files.map(
									(f) =>
										`  ${compactPath(f.path)}: ${fmt(f.tokens)} · ${f.chars} chars`,
								);
					await presentText("Memory files", lines.join("\n"), ctx);
					return;
				}
				// Path match only against already-loaded context files - no filesystem reads.
				const match = files.find((f) => f.path.includes(substr) || compactPath(f.path).includes(substr));
				if (!match) {
					const available = files.map((f) => compactPath(f.path)).join("\n  ");
					const shown = substr.length < substrRaw.length ? `${substr}…` : substr;
					const msg = `No context file path contains "${shown}".\nAvailable:\n  ${available || "(none)"}`;
					if (ctx.mode === "print" || !ctx.hasUI) {
						console.log(msg);
					} else {
						ctx.ui.notify(`No memory file matching "${shown}"`, "warning");
						await presentText("Memory files", msg, ctx);
					}
					return;
				}
				await presentText(`Memory · ${compactPath(match.path)}`, match.content, ctx);
				return;
			}

			if (sub === "tools") {
				await presentText("Tools", listToolsDetail(pi, ctx), ctx);
				return;
			}

			if (sub === "json") {
				const report = buildReport(pi, ctx);
				const json = reportToJson(report);
				if (ctx.mode === "print" || !ctx.hasUI) {
					console.log(json);
					return;
				}
				await showTextOverlay("Context JSON", json, ctx);
				return;
			}

			if (sub) {
				const msg = `Unknown subcommand "${sub}".\n\n${helpText()}`;
				if (ctx.mode === "print" || !ctx.hasUI) {
					console.log(msg);
				} else {
					ctx.ui.notify(`Unknown /context subcommand: ${sub}`, "warning");
					await presentText("Context help", msg, ctx);
				}
				return;
			}

			const report = buildReport(pi, ctx);
			if (ctx.mode === "print" || !ctx.hasUI) {
				console.log(plainReport(report));
				return;
			}
			await showContextOverlay(report, ctx);
		},
	});
}
