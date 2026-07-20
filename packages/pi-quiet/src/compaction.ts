/**
 * Run Compaction planner (pure).
 *
 * Folds maximal runs of strict-neighbor, same-kind, settled success|soft Quiet Rows
 * into Compaction Groups. Last member is the carrier; earlier members are hidden.
 */

import { isQuietToolName } from "./tools-meta.ts";

export type CompactionOutcomeKind = "success" | "soft" | "hard";

export type CompactionRow = {
	toolCallId: string;
	toolName: string;
	/** Quiet built-in that can join groups. */
	quiet: boolean;
	status: "pending" | "settled";
	/** Set when settled (except pure splitters). */
	outcomeKind?: CompactionOutcomeKind;
	chip?: string;
	/** Non-tool transcript boundary (assistant/user prose). */
	splitter?: boolean;
	args?: Record<string, unknown>;
	/** Stored for whole-group Stock expand on the carrier. */
	result?: {
		content: unknown[];
		details?: unknown;
	};
	isError?: boolean;
};

export type CompactionRole = {
	role: "singleton" | "hidden" | "carrier";
	groupId: string;
	carrierId: string;
	memberIds: string[];
};

export type CompactionPlan = Map<string, CompactionRole>;

function canJoinGroup(row: CompactionRow): boolean {
	if (row.splitter) return false;
	if (!row.quiet) return false;
	if (row.status !== "settled") return false;
	return row.outcomeKind === "success" || row.outcomeKind === "soft";
}

/** Same-kind Quiet row still running — blocks folding the settled prefix (no live growth). */
function isPendingSameKind(row: CompactionRow, kind: string): boolean {
	return (
		!row.splitter &&
		row.quiet &&
		row.toolName === kind &&
		row.status === "pending"
	);
}

/**
 * Plan compaction roles for an ordered transcript of tool rows (+ optional splitters).
 * Splitter / non-participating rows still appear as singleton so callers can ignore them.
 *
 * A run folds only when every member that could join is settled — a trailing
 * pending same-kind neighbor keeps the settled prefix as singletons.
 */
export function planCompaction(rows: readonly CompactionRow[]): CompactionPlan {
	const plan: CompactionPlan = new Map();

	const markSingleton = (id: string) => {
		plan.set(id, {
			role: "singleton",
			groupId: id,
			carrierId: id,
			memberIds: [id],
		});
	};

	let i = 0;
	while (i < rows.length) {
		const start = rows[i]!;
		if (!canJoinGroup(start)) {
			markSingleton(start.toolCallId);
			i += 1;
			continue;
		}

		const memberIds = [start.toolCallId];
		const kind = start.toolName;
		let j = i + 1;
		let blockedByPending = false;
		while (j < rows.length) {
			const next = rows[j]!;
			if (canJoinGroup(next) && next.toolName === kind) {
				memberIds.push(next.toolCallId);
				j += 1;
				continue;
			}
			if (isPendingSameKind(next, kind)) {
				blockedByPending = true;
			}
			break;
		}

		if (blockedByPending || memberIds.length < 2) {
			for (const id of memberIds) markSingleton(id);
			i += memberIds.length;
			continue;
		}

		const carrierId = memberIds[memberIds.length - 1]!;
		for (let k = 0; k < memberIds.length; k++) {
			const id = memberIds[k]!;
			plan.set(id, {
				role: k === memberIds.length - 1 ? "carrier" : "hidden",
				groupId: carrierId,
				carrierId,
				memberIds: [...memberIds],
			});
		}
		i = j;
	}

	return plan;
}

export function roleOf(plan: CompactionPlan, toolCallId: string): CompactionRole {
	const role = plan.get(toolCallId);
	if (role) return role;
	return {
		role: "singleton",
		groupId: toolCallId,
		carrierId: toolCallId,
		memberIds: [toolCallId],
	};
}

/** Mutable index used by the extension runtime. */
export class CompactionIndex {
	private rows: CompactionRow[] = [];
	private plan: CompactionPlan = new Map();
	private invalidators = new Map<string, () => void>();
	private splitterSeq = 0;

	clear(): void {
		this.rows = [];
		this.plan = new Map();
		this.invalidators.clear();
		this.splitterSeq = 0;
	}

	getRows(): readonly CompactionRow[] {
		return this.rows;
	}

	getPlan(): CompactionPlan {
		return this.plan;
	}

	role(toolCallId: string): CompactionRole {
		return roleOf(this.plan, toolCallId);
	}

	getRow(toolCallId: string): CompactionRow | undefined {
		return this.rows.find((r) => r.toolCallId === toolCallId && !r.splitter);
	}

	members(carrierId: string): CompactionRow[] {
		const role = this.role(carrierId);
		if (role.role !== "carrier" && role.memberIds.length < 2) {
			const self = this.getRow(carrierId);
			return self ? [self] : [];
		}
		return role.memberIds
			.map((id) => this.getRow(id))
			.filter((r): r is CompactionRow => r !== undefined);
	}

	registerInvalidate(toolCallId: string, invalidate: () => void): void {
		this.invalidators.set(toolCallId, invalidate);
	}

	/** Insert a transcript boundary so later tools are not adjacent to earlier ones. */
	addSplitter(): void {
		this.splitterSeq += 1;
		this.rows.push({
			toolCallId: `split-${this.splitterSeq}`,
			toolName: "",
			quiet: false,
			status: "settled",
			splitter: true,
		});
		this.replan();
	}

	onStart(input: {
		toolCallId: string;
		toolName: string;
		args?: Record<string, unknown>;
	}): void {
		const existing = this.rows.findIndex(
			(r) => r.toolCallId === input.toolCallId && !r.splitter,
		);
		if (existing >= 0) {
			const prev = this.rows[existing]!;
			// Historical paint / re-render must not unsettle a finished row
			// (that would unpack Compaction Groups rebuilt from session history).
			if (prev.status === "settled") {
				this.rows[existing] = {
					...prev,
					args: input.args ?? prev.args,
					toolName: input.toolName || prev.toolName,
				};
				return;
			}
			this.rows[existing] = {
				...prev,
				toolName: input.toolName,
				quiet: isQuietToolName(input.toolName),
				status: "pending",
				args: input.args ?? prev.args,
			};
		} else {
			this.rows.push({
				toolCallId: input.toolCallId,
				toolName: input.toolName,
				quiet: isQuietToolName(input.toolName),
				status: "pending",
				args: input.args,
			});
		}
		this.replan();
	}

	onEnd(input: {
		toolCallId: string;
		toolName: string;
		args?: Record<string, unknown>;
		outcomeKind: CompactionOutcomeKind;
		chip?: string;
		result?: CompactionRow["result"];
		isError?: boolean;
	}): void {
		const idx = this.rows.findIndex(
			(r) => r.toolCallId === input.toolCallId && !r.splitter,
		);
		const base: CompactionRow = {
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			quiet: isQuietToolName(input.toolName),
			status: "settled",
			outcomeKind: input.outcomeKind,
			chip: input.chip,
			args: input.args,
			result: input.result,
			isError: input.isError,
		};
		if (idx >= 0) {
			const prev = this.rows[idx]!;
			this.rows[idx] = {
				...base,
				args: input.args ?? prev.args,
			};
		} else {
			this.rows.push(base);
		}
		this.replan();
	}

	/** Replace index contents (session reload). Does not keep invalidators. */
	rebuild(rows: CompactionRow[]): void {
		this.rows = rows.map((r) => ({ ...r }));
		this.invalidators.clear();
		this.replan(false);
	}

	private replan(notify = true): void {
		const prev = this.plan;
		this.plan = planCompaction(this.rows);
		if (!notify) return;

		const changed = new Set<string>();
		for (const row of this.rows) {
			if (row.splitter) continue;
			const before = roleOf(prev, row.toolCallId);
			const after = roleOf(this.plan, row.toolCallId);
			if (
				before.role !== after.role ||
				before.carrierId !== after.carrierId ||
				before.memberIds.join("\0") !== after.memberIds.join("\0")
			) {
				changed.add(row.toolCallId);
				for (const id of before.memberIds) changed.add(id);
				for (const id of after.memberIds) changed.add(id);
			}
		}
		for (const id of changed) {
			this.invalidators.get(id)?.();
		}
	}
}
