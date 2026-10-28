/** Report → lines. Colors come from a Palette so the same layout serves the TUI and plain-text modes. */
import type { Report } from "./report.ts";
import type { SetupKind } from "./setup.ts";
import { fmtPercent, fmtTokens, preview, wrap } from "./units.ts";

export interface Palette {
	title(text: string): string;
	heading(text: string): string;
	dim(text: string): string;
	setup(text: string): string;
	conversation(text: string): string;
	warn(text: string): string;
}

export const plainPalette: Palette = {
	title: (t) => t,
	heading: (t) => t,
	dim: (t) => t,
	setup: (t) => t,
	conversation: (t) => t,
	warn: (t) => t,
};

interface Row {
	label: string;
	tokens: number;
	/** Right-hand context, such as call counts. */
	extra?: string;
}

const INDENT = "  ";
const BAR_CELLS = 14;
/** A row at or above this share of all used context is drawn as a warning. */
const HOT_SHARE = 0.25;
const KIND_NOUNS: Record<SetupKind, [singular: string, plural: string]> = {
	core: ["prompt part", "prompt parts"],
	tool: ["tool", "tools"],
	skill: ["skill", "skills"],
	"context-file": ["context file", "context files"],
	section: ["prompt section", "prompt sections"],
};

const count = (n: number, [singular, plural]: [string, string]) => `${n} ${n === 1 ? singular : plural}`;

function fit(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
}

export function renderReport(report: Report, p: Palette, width: number): string[] {
	const lines: string[] = [];
	const { rates, contextWindow: window } = report;
	const setupTokens = (chars: number) => chars * rates.setup;
	const conversationTokens = (chars: number) => chars * rates.conversation;
	const fixed = setupTokens(report.setupChars);
	const conversation = conversationTokens(report.conversationChars);
	const total = Math.max(1, report.totalTokens);
	const used = report.measuredTokens ?? report.totalTokens;
	const labelWidth = Math.max(14, Math.min(48, width - 36));

	const heading = (text: string, tokens?: number) => {
		lines.push("", p.heading(tokens === undefined ? text : `${text} · ${fmtTokens(tokens)}`));
	};
	/** Bars rank rows within one table; the percentage column carries the share of all used context. */
	const bar = (tokens: number, largest: number) => {
		const filled = tokens > 0 ? Math.max(1, Math.round((tokens / largest) * BAR_CELLS)) : 0;
		const paint = tokens / total >= HOT_SHARE ? p.warn : p.setup;
		return paint("█".repeat(filled)) + p.dim("░".repeat(BAR_CELLS - filled));
	};
	const note = (text: string, indent = INDENT) => {
		for (const line of wrap(text, Math.max(30, width - indent.length - 2))) lines.push(p.dim(`${indent}${line}`));
	};
	const table = (rows: readonly Row[], limit = rows.length) => {
		const shown = rows.slice(0, limit);
		const largest = Math.max(1, ...shown.map((r) => r.tokens));
		for (const row of shown) {
			const extra = row.extra ? `  ${p.dim(row.extra)}` : "";
			lines.push(
				`${INDENT}${fit(row.label, labelWidth)} ${fmtTokens(row.tokens).padStart(6)} ${fmtPercent(row.tokens, total).padStart(5)} ${bar(row.tokens, largest)}${extra}`,
			);
		}
		if (rows.length > limit) lines.push(p.dim(`${INDENT}… ${rows.length - limit} more`));
	};
	const setupRow = (label: string, chars: number, extra?: string): Row => ({ label, tokens: setupTokens(chars), extra });
	const conversationRow = (label: string, chars: number, extra?: string): Row => ({
		label,
		tokens: conversationTokens(chars),
		extra,
	});

	lines.push(p.title(`Context audit · ${report.model}`));
	const windowText = window ? ` of ${fmtTokens(window)} (${fmtPercent(used, window)})` : "";
	const basis = report.calibrated
		? `measured by the provider; sizes below are priced to match (${(1 / rates.setup).toFixed(1)} chars/token setup, ${(1 / rates.conversation).toFixed(1)} conversation)`
		: "estimated at 4 chars/token; no provider count yet";
	lines.push(`${fmtTokens(used)}${windowText}`);
	note(basis, "");

	const scale = Math.max(1, window ?? used);
	const cells = Math.max(10, Math.min(60, width - 4));
	const cellsFor = (tokens: number) => (tokens > 0 ? Math.max(1, Math.round(((tokens / total) * used * cells) / scale)) : 0);
	const setupCells = Math.min(cells, cellsFor(fixed));
	const conversationCells = Math.min(cells - setupCells, cellsFor(conversation));
	lines.push(p.setup("█".repeat(setupCells)) + p.conversation("█".repeat(conversationCells)) + p.dim("░".repeat(cells - setupCells - conversationCells)));
	lines.push(
		`${p.setup("█")} fixed overhead ${fmtTokens(fixed)} (${fmtPercent(fixed, total)})   ` +
			`${p.conversation("█")} conversation ${fmtTokens(conversation)} (${fmtPercent(conversation, total)})` +
			(window ? `   ${p.dim("░")} free ${fmtTokens(Math.max(0, window - used))}` : ""),
	);

	if (report.findings.length > 0) {
		heading("Findings");
		const textWidth = Math.max(30, width - 8);
		for (const finding of report.findings) {
			const mark = finding.level === "warn" ? p.warn("▲") : p.dim("•");
			wrap(finding.text, textWidth).forEach((line, i) => lines.push(`${INDENT}${i === 0 ? mark : " "} ${line}`));
			if (finding.lever) wrap(`→ ${finding.lever}`, textWidth).forEach((line) => lines.push(`${INDENT}  ${p.dim(line)}`));
		}
	}

	heading("Fixed overhead (sent on every request)", fixed);
	table(report.setupCategories.map((c) => setupRow(c.label, c.chars)));
	if (report.undeclaredTools > 0) {
		note(`${report.undeclaredTools} more registered tools are not declared to the model (inactive, deferred, or codemode) and add no declaration tokens.`);
	}

	heading("Conversation (grows each turn)", conversation);
	if (report.conversationCategories.length === 0) note("No messages yet.");
	table(report.conversationCategories.map((c) => conversationRow(c.label, c.chars)));

	heading("Fixed overhead by source");
	table(
		report.sources.map((s) =>
			setupRow(s.origin, s.chars, [...s.counts].map(([kind, n]) => count(n, KIND_NOUNS[kind])).join(" · ")),
		),
		12,
	);

	heading("Largest fixed items");
	table(report.setup.map((i) => setupRow(i.label, i.chars, i.origin)), 12);

	if (report.toolResults.length > 0) {
		heading("Tool results by tool");
		table(
			report.toolResults.map((t) =>
				conversationRow(t.tool, t.chars, `${count(t.count, ["call", "calls"])} · max ${fmtTokens(conversationTokens(t.largest))}`),
			),
			10,
		);
	}
	if (report.biggest.length > 0) {
		heading("Largest conversation blocks");
		table(report.biggest.map((b) => conversationRow(b.label || b.slot.kind, b.chars, `#${b.turn} ${b.slot.kind}`)));
	}
	if (report.repeats.length > 0) {
		heading("Repeated calls (every copy stays in context)");
		table(report.repeats.map((r) => conversationRow(r.label, r.chars, `${r.count}×`)), 8);
	}
	if (report.injected.length > 0) {
		heading("Extension-injected messages");
		table(report.injected.map((i) => conversationRow(i.label, i.chars)), 8);
	}
	if (report.jumps.length > 0) {
		heading("Biggest jumps between requests (provider-measured)");
		for (const jump of report.jumps) {
			const culprits = jump.culprits
				.slice(0, 2)
				.map((b) => `${preview(b.label || b.slot.kind, 50)} (${fmtTokens(conversationTokens(b.chars))})`)
				.join(" · ");
			lines.push(`${INDENT}#${String(jump.turn).padEnd(3)} ${p.warn(`+${fmtTokens(jump.deltaTokens)}`.padStart(7))} → ${fmtTokens(jump.promptTokens).padStart(5)}  ${culprits}`);
		}
	}

	lines.push("");
	note("Shares are of all used context. Tool declarations are sized from name + description + schema.", "");
	return lines;
}
