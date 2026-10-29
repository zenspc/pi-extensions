import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	classifyQuietTool,
	textLineCount,
	type QuietOutcome,
} from "./classify.ts";
import { groupKind } from "./format.ts";
import {
	resultIsImageFromContent,
	resultTextFromContent,
} from "./result-content.ts";

export type Row = {
	id: string;
	tool: string;
	args: Record<string, unknown>;
	outcome?: QuietOutcome;
	result?: AgentToolResult<unknown>;
	isError?: boolean;
};

type Message = {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
};

export function hasProse(message: Message): boolean {
	if (typeof message.content === "string")
		return Boolean(message.content.trim());
	return (
		Array.isArray(message.content) &&
		message.content.some(
			(block) =>
				(block?.type === "text" &&
					typeof block.text === "string" &&
					block.text.trim()) ||
				(block?.type === "thinking" &&
					typeof block.thinking === "string" &&
					block.thinking.trim())
		)
	);
}

export function classify(
	row: Pick<Row, "tool" | "args">,
	result: AgentToolResult<unknown>,
	isError: boolean,
	isPartial = false
): QuietOutcome {
	return classifyQuietTool({
		toolName: row.tool,
		isPartial,
		isError,
		text: resultTextFromContent(result.content),
		isImage: resultIsImageFromContent(result.content),
		diff:
			typeof (result.details as { diff?: unknown } | undefined)?.diff ===
			"string"
				? (result.details as { diff: string }).diff
				: undefined,
		contentLineCount: textLineCount(
			typeof row.args.content === "string" ? row.args.content : ""
		),
	});
}

function joinable(row: Row): boolean {
	return (
		Boolean(groupKind(row.tool)) &&
		Boolean(
			row.outcome &&
				row.outcome.kind !== "hard" &&
				row.outcome.kind !== "pending"
		) &&
		!resultIsImageFromContent(row.result?.content)
	);
}

/** Transcript order is call order, not completion order: parallel results must not reorder groups. */
export class QuietModel {
	private sequence: (Row | null)[] = [];
	private rows = new Map<string, Row>();
	private groups = new Map<string, Row[]>();
	private invalidators = new Map<string, () => void>();
	private rebuilding = false;

	get(id: string): Row | undefined {
		return this.rows.get(id);
	}
	members(id: string): readonly Row[] {
		return (
			this.groups.get(id) ??
			(this.rows.has(id) ? [this.rows.get(id)!] : [])
		);
	}
	isHidden(id: string): boolean {
		const group = this.groups.get(id);
		return Boolean(group && group[group.length - 1]?.id !== id);
	}
	watch(id: string, invalidate: () => void): void {
		this.invalidators.set(id, invalidate);
	}
	invalidate(): void {
		for (const invalidate of [...this.invalidators.values()]) invalidate();
	}

	clear(): void {
		this.sequence = [];
		this.rows.clear();
		this.groups.clear();
		this.invalidators.clear();
	}

	boundary(): void {
		if (
			this.sequence.length &&
			this.sequence[this.sequence.length - 1] !== null
		)
			this.sequence.push(null);
	}

	start(id: string, tool: string, args: Record<string, unknown> = {}): void {
		if (this.rows.has(id)) return;
		const row: Row = { id, tool, args };
		this.rows.set(id, row);
		this.sequence.push(row);
	}

	end(
		id: string,
		tool: string,
		result: AgentToolResult<unknown>,
		isError: boolean
	): void {
		this.start(id, tool);
		const row = this.rows.get(id)!;
		const outcome = classify(row, result, isError);
		row.outcome = { kind: outcome.kind, chip: outcome.chip };
		row.isError = isError;
		// Only foldable rows need retained bodies; singleton output stays owned by Pi.
		row.result = groupKind(tool) && !isError ? result : undefined;
		if (!this.rebuilding) this.replan();
	}

	rebuild(messages: readonly unknown[]): void {
		this.clear();
		this.rebuilding = true;
		for (const raw of messages) {
			if (!raw || typeof raw !== "object") continue;
			const message = raw as Message;
			if (
				message.role === "user" ||
				(message.role === "assistant" && hasProse(message))
			)
				this.boundary();
			if (
				message.role === "assistant" &&
				Array.isArray(message.content)
			) {
				for (const block of message.content) {
					if (
						block?.type === "toolCall" &&
						typeof block.id === "string" &&
						typeof block.name === "string"
					) {
						this.start(
							block.id,
							block.name,
							block.arguments &&
								typeof block.arguments === "object"
								? block.arguments
								: {}
						);
					}
				}
			}
			if (
				message.role === "toolResult" &&
				message.toolCallId &&
				message.toolName
			) {
				this.end(
					message.toolCallId,
					message.toolName,
					{
						content: Array.isArray(message.content)
							? message.content
							: [],
						details: message.details,
					},
					Boolean(message.isError)
				);
			}
		}
		for (const row of this.rows.values()) {
			if (!row.outcome)
				row.outcome = { kind: "hard", chip: "interrupted" };
		}
		this.rebuilding = false;
		this.replan();
	}

	private replan(): void {
		const previous = this.groups;
		this.groups = new Map();
		let run: Row[] = [];
		const flush = () => {
			if (run.length > 1)
				for (const row of run) this.groups.set(row.id, run);
			run = [];
		};
		for (const row of this.sequence) {
			if (!row || !joinable(row)) {
				flush();
				continue;
			}
			if (run.length && groupKind(run[0]!.tool) !== groupKind(row.tool))
				flush();
			run.push(row);
		}
		flush();
		for (const id of this.rows.keys()) {
			const before = previous.get(id);
			const after = this.groups.get(id);
			if (
				before?.length !== after?.length ||
				before?.[0]?.id !== after?.[0]?.id ||
				before?.at(-1)?.id !== after?.at(-1)?.id
			) {
				this.invalidators.get(id)?.();
			}
		}
	}
}
