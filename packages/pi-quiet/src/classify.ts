/**
 * Outcome classification for Quiet Rows.
 *
 * success → Success Chip only (collapsed)
 * soft    → Soft Breakthrough (compact chip, no auto-expand body)
 * hard    → Hard Breakthrough (chip + capped tail when shown as breakthrough)
 * pending → static pending marker
 */

export type QuietOutcomeKind = "pending" | "success" | "soft" | "hard";

export type QuietOutcome = {
	kind: QuietOutcomeKind;
	/** Short chip text without leading separator. */
	chip?: string;
	/** Optional full body text for hard breakthrough tails / errors. */
	body?: string;
};

export type ExploreTool = "grep" | "find" | "ls";

export function textLineCount(text: string): number {
	if (!text) return 0;
	return text.split("\n").filter((line) => line.length > 0).length;
}

/** Count +/− lines in a unified/display diff, ignoring file headers. */
export function diffLineStats(diff: string | undefined): { added: number; removed: number } {
	if (!diff) return { added: 0, removed: 0 };
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return { added, removed };
}

function hard(chip: string, body?: string): QuietOutcome {
	return { kind: "hard", chip, body: body ?? chip };
}

export function classifyReadOutcome(input: {
	isPartial: boolean;
	isError: boolean;
	text: string;
	isImage?: boolean;
}): QuietOutcome {
	if (input.isPartial) return { kind: "pending" };
	if (input.isError) return hard("failed", input.text);
	if (input.isImage) return { kind: "success", chip: "image" };
	const n = textLineCount(input.text);
	return { kind: "success", chip: `${n} line${n === 1 ? "" : "s"}` };
}

export function classifyExploreOutcome(input: {
	tool: ExploreTool;
	isPartial: boolean;
	isError: boolean;
	text: string;
}): QuietOutcome {
	if (input.isPartial) return { kind: "pending" };
	if (input.isError) return hard("failed", input.text);

	const n = textLineCount(input.text);
	const label =
		input.tool === "grep"
			? n === 1
				? "1 match"
				: `${n} matches`
			: input.tool === "find"
				? n === 1
					? "1 file"
					: `${n} files`
				: n === 1
					? "1 entry"
					: `${n} entries`;

	if (n === 0) return { kind: "soft", chip: label };
	return { kind: "success", chip: label };
}

export function classifyBashOutcome(input: {
	isPartial: boolean;
	isError: boolean;
	text: string;
}): QuietOutcome {
	if (input.isPartial) return { kind: "pending" };
	if (input.isError) {
		const exit = input.text.match(/exited with code (\d+)/i);
		const chip = exit ? `exit ${exit[1]}` : "failed";
		return hard(chip, input.text);
	}
	const empty = textLineCount(input.text) === 0;
	if (empty) return { kind: "soft", chip: "exit 0 · empty" };
	return { kind: "success", chip: "exit 0" };
}

export function classifyEditOutcome(input: {
	isPartial: boolean;
	isError: boolean;
	diff?: string;
	text: string;
}): QuietOutcome {
	if (input.isPartial) return { kind: "pending" };
	if (input.isError) return hard("failed", input.text);
	const { added, removed } = diffLineStats(input.diff);
	return { kind: "success", chip: `+${added} -${removed}` };
}

export function classifyWriteOutcome(input: {
	isPartial: boolean;
	isError: boolean;
	contentLineCount: number;
	text: string;
}): QuietOutcome {
	if (input.isPartial) return { kind: "pending" };
	if (input.isError) return hard("failed", input.text);
	const n = input.contentLineCount;
	return { kind: "success", chip: `${n} line${n === 1 ? "" : "s"}` };
}

export type ClassifyToolInput = {
	toolName: string;
	isPartial: boolean;
	isError: boolean;
	text: string;
	isImage?: boolean;
	diff?: string;
	/** write content line count from args */
	contentLineCount?: number;
};

/** Dispatch to the per-tool classifier for Quiet built-ins. */
export function classifyQuietTool(input: ClassifyToolInput): QuietOutcome {
	switch (input.toolName) {
		case "read":
			return classifyReadOutcome({
				isPartial: input.isPartial,
				isError: input.isError,
				text: input.text,
				isImage: input.isImage,
			});
		case "bash":
			return classifyBashOutcome({
				isPartial: input.isPartial,
				isError: input.isError,
				text: input.text,
			});
		case "edit":
			return classifyEditOutcome({
				isPartial: input.isPartial,
				isError: input.isError,
				diff: input.diff,
				text: input.text,
			});
		case "write":
			return classifyWriteOutcome({
				isPartial: input.isPartial,
				isError: input.isError,
				contentLineCount: input.contentLineCount ?? 0,
				text: input.text,
			});
		case "grep":
		case "find":
		case "ls":
			return classifyExploreOutcome({
				tool: input.toolName,
				isPartial: input.isPartial,
				isError: input.isError,
				text: input.text,
			});
		default:
			if (input.isPartial) return { kind: "pending" };
			if (input.isError) return hard("failed", input.text);
			return { kind: "success", chip: "ok" };
	}
}
