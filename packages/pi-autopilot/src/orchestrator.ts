import { randomUUID } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkedPath, Git } from "./git.ts";
import { candidates } from "./models.ts";
import { QuotaError, SpawnLimitError, StoppedError, processIdentity, terminateRecorded, runProcess, type ProcessResult } from "./process.ts";
import { isDeepStrictEqual } from "node:util";
import { reviewerPrompt, workerPrompt } from "./prompts.ts";
import { readyBatch, validateTasks, type Models, type Plan, type Task, type TaskInput, type Tier } from "./schema.ts";
import { Store } from "./state.ts";

const guardPath = fileURLToPath(new URL("./guard.ts", import.meta.url));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(-32_000);
type Options = {
	binary?: string;
	runner?: typeof runProcess;
	onChange?: (plan: Plan) => void;
	onMilestone?: (event: string, plan: Plan) => void;
};

export class Orchestrator {
	readonly store: Store;
	readonly git: Git;
	plan?: Plan;
	models?: Models;
	enabled = false;
	busy = false;
	private stopping = false;
	private pauseRequested = false;
	private controller = new AbortController();
	private exhausted = new Set<string>();
	private operation?: Promise<unknown>;
	private waitTimer?: ReturnType<typeof setTimeout>;
	private options: Options;

	constructor(root: string, options: Options = {}) {
		this.store = new Store(root);
		this.git = new Git(this.store.root, this.store.dir);
		this.options = options;
	}
	private checkpoint(event?: string): void {
		this.store.save(this.plan!);
		this.options.onChange?.(this.plan!);
		if (event) this.options.onMilestone?.(event, this.plan!);
	}
	private async perform<T>(work: () => Promise<T>): Promise<T> {
		if (!this.enabled) throw new Error("Start or resume autopilot first");
		if (this.busy) throw new Error("Another orchestration operation is running");
		this.busy = true;
		const operation = work();
		this.operation = operation;
		try { return await operation; }
		finally {
			this.busy = false;
			this.operation = undefined;
			if (this.pauseRequested || this.stopping || this.plan?.status === "blocked" ||
				this.plan?.status === "completed" || (this.plan?.status === "paused_quota" && !this.plan.autoWait)) {
				this.enabled = false;
				this.store.release();
			}
		}
	}
	private resetControl(): void {
		this.stopping = false;
		this.pauseRequested = false;
		this.controller = new AbortController();
		this.exhausted.clear();
		this.enabled = true;
	}
	async start(goal: string): Promise<void> {
		if (process.platform === "win32") throw new Error("Autopilot requires POSIX process groups; use WSL on Windows");
		if (!goal.trim() || goal.length > 24_000) throw new Error("Usage: /autopilot <goal up to 24000 characters>");
		if (this.enabled || this.busy) throw new Error("Autopilot is already active");
		this.store.acquire();
		try {
			const previous = this.store.load();
			if (previous && !["completed", "stopped"].includes(previous.status)) {
				throw new Error("An unfinished run exists. Use /autopilot-resume or /autopilot-stop first");
			}
			this.models = this.store.models();
			await this.git.assertRepository();
			const now = new Date().toISOString();
			this.plan = {
				version: 1, runId: randomUUID(), root: this.store.root, goal: goal.trim(), status: "scouting",
				autoWait: false, scoutBrief: "", scoutsCompleted: 0, totalSpawns: 0, supervisorTurns: 0,
				noProgressTurns: 0, revision: 0, createdAt: now, updatedAt: now, lastError: "", workers: [], tasks: [],
			};
			this.resetControl();
			this.checkpoint("started");
		} catch (error) { this.enabled = false; this.store.release(); throw error; }
	}
	async resume(autoWait: boolean): Promise<void> {
		if (process.platform === "win32") throw new Error("Autopilot requires POSIX process groups; use WSL on Windows");
		if (this.enabled || this.busy) throw new Error("Autopilot is already active");
		this.store.acquire();
		try {
			this.plan = this.store.load();
			if (!this.plan) throw new Error("No .pi/autopilot/plan.json or scouting journal found");
			this.models = this.store.models();
			for (const task of this.plan.tasks) {
				if (task.status !== "verified" && !this.models.available.includes(task.model)) {
					const tier = task.retries && ["fast", "standard"].includes(task.complexityTier) ? "deep" : task.complexityTier;
					task.model = this.models.tiers[tier].primary;
				}
			}
			if (this.plan.tasks.length) validateTasks(this.plan.tasks.map(inputOnly), {
				...this.models, available: [...new Set([...this.models.available, ...this.plan.tasks.filter((task) => task.status === "verified").map((task) => task.model)])],
			});
			await this.reapWorkers();
			for (let i = 0; i < 3; i++) await this.git.remove(this.plan, makeScout(i));
			for (const task of this.plan.tasks) {
				const published = await this.git.recoverPublication(this.plan, task);
				if (published) { task.status = "verified"; task.gitCheckpoint = published; }
				if (task.status === "running" || task.status === "paused_quota") task.status = "pending";
				await this.git.remove(this.plan, task);
				delete task.candidateCommit;
				delete task.publishBase;
			}
			await this.git.assertRepository();
			this.plan.autoWait = autoWait;
			this.plan.noProgressTurns = 0;
			this.resetControl();
			if (!this.completeIfDone() && (this.plan.tasks.some((task) => task.retries >= 3 && task.status !== "verified") || this.plan.totalSpawns >= 64 || this.plan.supervisorTurns >= 128)) {
				this.plan.status = "blocked";
				this.checkpoint("hard_blocker");
				this.enabled = false;
				this.store.release();
				return;
			}
			this.plan.status = this.plan.tasks.length ? "running" : this.plan.scoutsCompleted ? "planning" : "scouting";
			const completed = this.completeIfDone();
			this.checkpoint("resumed");
			if (completed) { this.enabled = false; this.store.release(); }
		} catch (error) { this.enabled = false; this.store.release(); throw error; }
	}
	private completeIfDone(): boolean {
		if (this.plan!.tasks.length && this.plan!.tasks.every((task) => task.status === "verified")) this.plan!.status = "completed";
		return this.plan!.status === "completed";
	}
	private isQuotaPaused(): boolean { return this.plan!.status === "paused_quota"; }
	async scout(queries: string[]): Promise<string> {
		if (!queries.length || queries.length > 3 || queries.some((q) => !q.trim() || q.length > 4000)) throw new Error("Use one to three bounded scouting queries");
		return this.perform(async () => {
			const plan = this.plan!;
			if (plan.tasks.length || plan.scoutsCompleted) throw new Error("Phase 0 scouting already completed");
			const results = await Promise.allSettled(queries.map(async (query, i) => {
				const task = makeScout(i);
				try {
					const result = await this.withModel(task, "scout", async () => {
						await this.git.create(plan, task);
						return this.spawn(task, `Read-only architecture scouting for: ${plan.goal}\nFocus: ${query}\nMap relevant files, exports, architecture patterns, and exact test commands. Do not run commands or modify files. Use built-in tools, not MCP. Return at most 100 words.`, "scout");
					});
					await this.git.validateChanges(task);
					return result.text.slice(0, Math.floor(2000 / queries.length));
				} finally { await this.git.remove(plan, task); }
			}));
			const failure = results.find((r) => r.status === "rejected");
			if (failure?.status === "rejected") {
				await this.handleOperationError(failure.reason);
				throw failure.reason;
			}
			plan.scoutBrief = results.map((r, i) => `Scout ${i + 1}: ${r.status === "fulfilled" ? r.value : ""}`).join("\n").slice(0, 2200);
			plan.scoutsCompleted = queries.length;
			if (!this.pauseRequested && !this.stopping) plan.status = "planning";
			plan.noProgressTurns = 0;
			this.checkpoint("scouted");
			return plan.scoutBrief;
		});
	}
	async savePlan(inputs: TaskInput[]): Promise<void> {
		return this.perform(async () => {
			const plan = this.plan!;
			if (!plan.scoutsCompleted) throw new Error("run_scouts must finish before creating plan.json");
			if (this.pauseRequested || this.stopping || plan.status === "paused_quota") throw new Error("Run is paused");
			validateTasks(inputs, this.models!);
			for (const task of inputs) for (const file of task.filesToTouch) {
				const path = checkedPath(this.store.root, file, true);
				if (existsSync(path) && lstatSync(path).isDirectory()) throw new Error(`Reserve exact files, not directories: ${file}`);
			}
			for (const old of plan.tasks) {
				const updated = inputs.find((task) => task.id === old.id);
				if (!updated) throw new Error("Tasks cannot be removed from an active run");
				if (old.status !== "pending" && !isDeepStrictEqual(inputOnly(old), updated)) {
					throw new Error(`Cannot change ${old.status} task ${old.id}`);
				}
			}
			plan.tasks = inputs.map((input) => {
				const old = plan.tasks.find((task) => task.id === input.id);
				return { ...input, status: "pending", retries: 0, gitCheckpoint: "", resultSummary: "", lastError: "", ...old, ...input } as Task;
			});
			plan.status = "running";
			this.checkpoint("plan_saved");
		});
	}
	async dispatch(ids?: string[]): Promise<string[]> {
		return this.perform(async () => {
			const plan = this.plan!;
			if (plan.status !== "running" || this.pauseRequested || this.stopping) throw new Error("Run is not dispatchable");
			if (plan.tasks.some((t) => t.retries >= 3 && t.status !== "verified")) throw new Error("A task reached its failure ceiling");
			const batch = readyBatch(plan.tasks, ids);
			if (!batch.length) throw new Error("No ready tasks in this batch");
			for (const task of batch) { task.status = "running"; task.lastError = task.lastError.slice(-32_000); }
			this.checkpoint("batch_started");
			const outputs: string[] = [];
			// Worker processes run in parallel; verification/review/publication remain serialized.
			const results = await Promise.allSettled(batch.map((task) => this.code(task)));
			for (let i = 0; i < batch.length; i++) {
				const task = batch[i];
				try {
					let result = results[i];
					while (true) {
						try {
							if (result.status === "rejected") throw result.reason;
							if (this.stopping || this.isQuotaPaused()) throw new StoppedError("Run interrupted");
							await this.verify(task, result.value);
							outputs.push(JSON.stringify({ id: task.id, status: "verified", model: task.model, checkpoint: task.gitCheckpoint, summary: task.resultSummary.slice(0, 160) }));
							break;
						} catch (error) {
							if (error instanceof QuotaError || error instanceof StoppedError || error instanceof SpawnLimitError) {
								task.status = this.isQuotaPaused() ? "paused_quota" : "pending";
								task.lastError = errorText(error);
								await this.handleOperationError(error);
								break;
							}
							let diff = "";
							try { diff = await this.git.validateChanges(task); } catch (diffError) { diff = errorText(diffError); }
							task.lastError = `${errorText(error).slice(0, 16_000)}\nDiff before rollback:\n${diff.slice(0, 31_000)}`;
							task.retries++;
							task.status = task.retries >= 3 ? "failed" : "pending";
							await this.git.remove(plan, task);
							delete task.candidateCommit;
							delete task.publishBase;
							if (task.status === "failed") plan.status = "blocked";
							this.checkpoint(task.status === "failed" ? "task_blocked" : "retrying");
							if (task.status === "failed" || this.pauseRequested || this.stopping) break;
							try { result = { status: "fulfilled", value: await this.code(task) }; }
							catch (retryError) { result = { status: "rejected", reason: retryError }; }
						}
					}
				} finally {
					await this.git.remove(plan, task);
					this.checkpoint();
				}
			}
			this.completeIfDone();
			this.checkpoint("batch_finished");
			return outputs;
		});
	}
	private async code(task: Task): Promise<ProcessResult> {
		if (this.stopping || this.plan!.status === "paused_quota") throw new StoppedError("Run interrupted");
		if (task.retries && ["fast", "standard"].includes(task.complexityTier)) {
			task.model = this.models!.tiers.deep.primary;
			task.thinkingLevel = "high";
		}
		const tier: Tier = task.retries && ["fast", "standard"].includes(task.complexityTier) ? "deep" : task.complexityTier;
		return this.withModel(task, tier, async () => {
			await this.git.create(this.plan!, task);
			task.status = "running";
			return this.spawn(task, workerPrompt(this.plan!, task), task.role);
		});
	}
	private async withModel<T>(task: Task, tier: Tier, run: () => Promise<T>): Promise<T> {
		for (const model of candidates(this.models!, tier, task.model || undefined)) {
			if (this.exhausted.has(model.split("/")[0])) continue;
			task.model = model;
			try { return await run(); }
			catch (error) {
				if (!(error instanceof QuotaError)) throw error;
				this.exhausted.add(model.split("/")[0]);
				task.lastError = errorText(error);
				this.checkpoint("provider_exhausted");
			}
		}
		this.quotaPause("All configured providers for this task are exhausted");
		throw new QuotaError(this.plan!.lastError);
	}
	private async spawn(task: Task, prompt: string, role: Task["role"]): Promise<ProcessResult> {
		const plan = this.plan!;
		if (this.controller.signal.aborted) throw new StoppedError("Run interrupted");
		if (plan.totalSpawns >= 64) throw new SpawnLimitError("Run reached maxTotalSpawns: 64");
		plan.totalSpawns++;
		const token = randomUUID();
		this.checkpoint("worker_started");
		try {
			return await (this.options.runner ?? runProcess)(this.options.binary ?? "pi", [
				"--mode", "json", "--no-session", "--model", task.model, "--thinking", task.thinkingLevel,
				"--tools", task.allowedTools, "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates",
				"--extension", guardPath, "-p", prompt,
			], {
				cwd: task.workspace!, json: true, signal: this.controller.signal,
				onSpawn: (pid) => {
					plan.workers.push({ pid, identity: processIdentity(pid), token, taskId: task.id, model: task.model, workspace: task.workspace! });
					this.checkpoint();
				},
				env: { PI_AUTOPILOT_WORKER: "1", PI_AUTOPILOT_TOKEN: token, PI_AUTOPILOT_PARENT: String(process.pid), PI_AUTOPILOT_POLICY: JSON.stringify({
					root: task.workspace, role, files: role === "coder" ? task.filesToTouch : [],
					tools: task.allowedTools.split(","), base: task.gitCheckpoint,
				}) },
			});
		} finally {
			plan.workers = plan.workers.filter((worker) => worker.token !== token);
			this.checkpoint("worker_finished");
		}
	}
	private async verify(task: Task, result: ProcessResult): Promise<void> {
		const plan = this.plan!;
		task.resultSummary = result.text.slice(0, 1800);
		await this.git.refreshBase(task);
		this.checkpoint("verification_started");
		await this.git.validateChanges(task);
		const verification = await (this.options.runner ?? runProcess)(process.platform === "win32" ? "cmd.exe" : "/bin/sh",
			process.platform === "win32" ? ["/d", "/s", "/c", task.verificationCommand] : ["-c", task.verificationCommand], {
				cwd: task.workspace!, signal: this.controller.signal, durationMs: 600_000, inactivityMs: 300_000,
			});
		if (verification.code) throw new Error(`Verification failed (${verification.code}):\n${verification.output}\n${verification.stderr}`);
		const diff = await this.git.validateChanges(task);
		const reviewer: Task = {
			...task, id: task.id + "-review", role: "reviewer", model: this.models!.tiers.reviewer.primary,
			thinkingLevel: "low", allowedTools: "read,grep,bash", filesToTouch: [],
		};
		const review = await this.withModel(reviewer, "reviewer", () => this.spawn(reviewer, reviewerPrompt(plan, task), "reviewer"));
		let verdict: { pass?: boolean; summary?: string };
		try { verdict = JSON.parse(review.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
		catch { throw new Error(`Reviewer returned invalid JSON: ${review.text}`); }
		if (verdict?.pass !== true || typeof verdict.summary !== "string" || !verdict.summary.trim()) {
			throw new Error(`Reviewer rejected task: ${verdict?.summary || review.text}`);
		}
		if (await this.git.validateChanges(task) !== diff) throw new Error("Read-only reviewer modified the worktree");
		if (this.controller.signal.aborted) throw new StoppedError("Stopped before publication");
		task.candidateCommit = await this.git.candidate(plan, task);
		task.publishBase = await this.git.head();
		this.checkpoint("publishing");
		if (this.controller.signal.aborted) throw new StoppedError("Stopped before publication");
		try { task.gitCheckpoint = await this.git.publish(plan, task); }
		catch (error) {
			const recovered = await this.git.recoverPublication(plan, task);
			if (recovered) task.gitCheckpoint = recovered;
			else throw error;
		}
		task.status = "verified";
		task.lastError = "";
		task.resultSummary = `${task.resultSummary}\nReview: ${verdict.summary}`.slice(0, 2000);
		plan.noProgressTurns = 0;
		this.checkpoint("task_verified");
	}
	private async reapWorkers(): Promise<void> {
		for (const worker of this.plan!.workers) await terminateRecorded(worker, guardPath);
		this.plan!.workers = [];
	}
	private async handleOperationError(error: unknown): Promise<void> {
		if (error instanceof QuotaError) this.quotaPause(errorText(error));
		else if (error instanceof SpawnLimitError) { this.plan!.status = "blocked"; this.plan!.lastError = errorText(error); }
		else if (!(error instanceof StoppedError)) this.plan!.lastError = errorText(error);
		this.checkpoint();
	}
	quotaPause(reason: string): void {
		const plan = this.plan!;
		if (this.stopping || this.pauseRequested) return;
		plan.status = "paused_quota";
		plan.lastError = reason;
		for (const task of plan.tasks) if (["running", "pending"].includes(task.status)) task.status = "paused_quota";
		this.controller.abort();
		this.checkpoint("paused_quota");
	}
	scheduleQuotaRetry(wake: () => void, intervalMs = 900_000): void {
		if (!this.enabled || !this.plan?.autoWait || this.plan.status !== "paused_quota" || this.waitTimer) return;
		this.waitTimer = setTimeout(() => {
			this.waitTimer = undefined;
			if (!this.enabled || this.stopping || this.pauseRequested) return;
			this.controller = new AbortController();
			this.exhausted.clear();
			for (const task of this.plan!.tasks) if (task.status === "paused_quota") task.status = "pending";
			this.plan!.status = this.plan!.tasks.length ? "running" : this.plan!.scoutsCompleted ? "planning" : "scouting";
			this.checkpoint("quota_retry");
			wake();
		}, intervalMs);
	}
	async pause(): Promise<void> {
		if (!this.enabled) return;
		this.pauseRequested = true;
		if (this.waitTimer) clearTimeout(this.waitTimer);
		this.waitTimer = undefined;
		this.plan!.status = "paused";
		this.checkpoint("pause_requested");
		if (!this.busy) { this.enabled = false; this.store.release(); }
	}
	async stop(): Promise<void> {
		if (this.waitTimer) clearTimeout(this.waitTimer);
		this.waitTimer = undefined;
		if (!this.enabled && !this.busy) {
			this.store.acquire();
			try {
				this.plan = this.store.load();
				if (!this.plan) { this.store.release(); return; }
				await this.reapWorkers();
				for (let i = 0; i < 3; i++) await this.git.remove(this.plan, makeScout(i));
				for (const task of this.plan.tasks) {
					const published = await this.git.recoverPublication(this.plan, task);
					if (published) { task.status = "verified"; task.gitCheckpoint = published; }
					else if (task.status === "running") task.status = "pending";
					await this.git.remove(this.plan, task);
					delete task.candidateCommit;
					delete task.publishBase;
				}
			} catch (error) { this.store.release(); throw error; }
		}
		this.stopping = true;
		this.controller.abort();
		this.plan!.status = "stopped";
		this.checkpoint("stop_requested");
		try { await this.operation; } catch { /* An interrupted tool reports its own failure. */ }
		this.enabled = false;
		this.store.release();
	}
	supervisorTurnEnded(): void {
		if (!this.enabled || this.busy || this.plan!.status === "paused_quota") return;
		this.plan!.supervisorTurns++;
		if (this.plan!.supervisorTurns >= 128) {
			this.plan!.status = "blocked";
			this.plan!.lastError = "Supervisor reached its 128-turn safety ceiling";
			this.checkpoint("supervisor_blocked");
			this.enabled = false;
			this.store.release();
		} else this.checkpoint();
	}
	async supervisorEnded(error?: string): Promise<void> {
		if (!this.enabled || this.busy) return;
		if (error) {
			if (/\b429\b|rate[_ -]?limit|quota|usage[_ -]?(?:cap|limit)|overloaded/i.test(error)) this.quotaPause(error);
			else this.plan!.lastError = error.slice(-32_000);
		}
		if (this.plan!.status === "paused_quota") {
			if (!this.plan!.autoWait) { this.enabled = false; this.store.release(); }
			return;
		}
		this.plan!.noProgressTurns++;
		if (this.plan!.noProgressTurns >= 3 || this.plan!.supervisorTurns >= 128) {
			this.plan!.status = "blocked";
			this.plan!.lastError ||= "Supervisor made no verified/scouting progress for three runs or reached its turn ceiling";
			this.checkpoint("supervisor_blocked");
			this.enabled = false;
			this.store.release();
		} else this.checkpoint();
	}
	status(): string {
		const plan = this.enabled || this.busy ? this.plan : this.store.load();
		if (!plan) return "Autopilot: no saved run";
		const count = (status: Task["status"]) => plan.tasks.filter((t) => t.status === status).length;
		return `Autopilot ${plan.status}: Scouted ${plan.scoutsCompleted} | Pending ${count("pending")} | Running ${count("running")} | Verified ${count("verified")} | Retrying ${plan.tasks.filter((t) => t.retries > 0 && ["pending", "running"].includes(t.status)).length} | Paused ${count("paused_quota")} | Failed ${count("failed")} | Spawns ${plan.totalSpawns}/64\n` +
			plan.workers.map((worker) => `${worker.taskId}: ${worker.model}`).join("\n");
	}
}

function inputOnly(task: Task): TaskInput {
	const { id, title, description, dependencies, role, complexityTier, model, thinkingLevel, allowedTools, filesToTouch, verificationCommand } = task;
	return { id, title, description, dependencies, role, complexityTier, model, thinkingLevel, allowedTools, filesToTouch, verificationCommand };
}
function makeScout(i: number): Task {
	return {
		id: `phase0-scout-${i + 1}`, title: "Phase 0 architecture scout", description: "Read-only architecture map",
		dependencies: [], role: "scout", complexityTier: "scout", model: "", thinkingLevel: "low",
		allowedTools: "read,grep,find,ls", filesToTouch: [], verificationCommand: "true", status: "running",
		retries: 0, gitCheckpoint: "", resultSummary: "", lastError: "",
	};
}
