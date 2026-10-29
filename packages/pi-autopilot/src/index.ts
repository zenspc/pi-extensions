import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { discoverModels } from "./models.ts";
import { Orchestrator } from "./orchestrator.ts";
import { supervisorPrompt } from "./prompts.ts";
import { TaskInputSchema } from "./schema.ts";

const tools = ["run_scouts", "save_or_update_plan", "dispatch_subagents"];
const result = (value: unknown) => ({
	content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
	details: undefined,
});

export default function autopilotExtension(pi: ExtensionAPI): void {
	if (process.env.PI_AUTOPILOT_WORKER) return;
	let engine: Orchestrator | undefined;
	let context: ExtensionContext | undefined;
	let previousTools: string[] | undefined;
	let unsubscribe: (() => void) | undefined;
	let continuationQueued = false;

	function update(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setStatus("autopilot", engine?.enabled ? engine.status().split("\n")[0] : undefined);
	}
	function restore(): void {
		if (previousTools) pi.setActiveTools(previousTools);
		previousTools = undefined;
		if (context) update(context);
	}
	function get(ctx: ExtensionContext): Orchestrator {
		if (engine && engine.store.root !== ctx.cwd && engine.enabled) throw new Error("Cannot change repository during autopilot");
		if (!engine || engine.store.root !== ctx.cwd) {
			engine = new Orchestrator(ctx.cwd, {
				onChange: () => { if (context) update(context); },
				onMilestone: (event, plan) => pi.appendEntry("autopilot", {
					event, runId: plan.runId, revision: plan.revision, status: plan.status,
					tasks: plan.tasks.map(({ id, status, model, retries }) => ({ id, status, model, retries })),
				}),
			});
		}
		context = ctx;
		return engine;
	}
	function activate(ctx: ExtensionContext): void {
		context = ctx;
		previousTools ??= pi.getActiveTools();
		pi.setActiveTools(tools);
		if (ctx.mode === "tui" && !unsubscribe) {
			unsubscribe = ctx.ui.onTerminalInput((data) => engine?.enabled && matchesKey(data, Key.escape) ? { consume: true } : undefined);
		}
		update(ctx);
	}
	function continueRun(ctx: ExtensionContext): void {
		if (!engine?.enabled || continuationQueued || ["paused", "stopped", "blocked", "completed", "paused_quota"].includes(engine.plan!.status)) return;
		continuationQueued = true;
		pi.sendUserMessage(`Continue autopilot run ${engine.plan!.runId}. ${engine.status()}\nUse the orchestration tools and finish the goal autonomously.`,
			ctx.isIdle() ? {} : { deliverAs: "followUp" });
	}
	async function command(ctx: ExtensionContext, work: (current: Orchestrator) => Promise<void>): Promise<void> {
		try { await work(get(ctx)); }
		catch (error) { ctx.ui.notify(String(error), "error"); }
		finally { if (!engine?.enabled) restore(); update(ctx); }
	}

	pi.registerCommand("autopilot-models", {
		description: "Discover authenticated Pi model IDs and update .pi/autopilot/models.json",
		handler: async (_args, ctx) => command(ctx, async (current) => {
			if (current.enabled || current.busy) throw new Error("Pause autopilot before changing its routing configuration");
			current.store.acquire();
			try {
				const models = await discoverModels(current.store);
				ctx.ui.notify(`Discovered ${models.available.length} models. Routes saved to .pi/autopilot/models.json; review the tier choices before your first run.`, "info");
			} finally { current.store.release(); }
		}),
	});
	pi.registerCommand("autopilot", {
		description: "Start autonomous Supervisor-Worker execution: /autopilot <goal>",
		handler: async (goal, ctx) => command(ctx, async (current) => {
			await current.start(goal);
			activate(ctx);
			continueRun(ctx);
		}),
	});
	pi.registerCommand("autopilot-resume", {
		description: "Resume the persistent DAG: /autopilot-resume [--auto-wait]",
		handler: async (args, ctx) => command(ctx, async (current) => {
			if (args.trim() && args.trim() !== "--auto-wait") throw new Error("Usage: /autopilot-resume [--auto-wait]");
			await current.resume(args.trim() === "--auto-wait");
			if (current.enabled) { activate(ctx); continueRun(ctx); }
			else ctx.ui.notify(current.status(), "info");
		}),
	});
	pi.registerCommand("autopilot-status", {
		description: "Show saved/live DAG state and running worker model IDs",
		handler: async (_args, ctx) => command(ctx, async (current) => { ctx.ui.notify(current.status(), "info"); }),
	});
	pi.registerCommand("autopilot-pause", {
		description: "Pause after the current batch finishes verification and review",
		handler: async (_args, ctx) => command(ctx, async (current) => {
			await current.pause();
			ctx.ui.notify(current.busy ? "Pause requested; current workers will finish." : "Autopilot paused.", "info");
		}),
	});
	pi.registerCommand("autopilot-stop", {
		description: "Terminate active worker process groups and save the DAG",
		handler: async (_args, ctx) => command(ctx, async (current) => {
			await current.stop();
			ctx.ui.notify("Autopilot stopped. Saved state can be resumed.", "info");
		}),
	});

	pi.registerTool({
		name: "run_scouts", label: "Autopilot scouts", defaultActive: false, executionMode: "sequential",
		description: "Run 1-3 parallel read-only Phase 0 scouts before planning. Returns only a compact architecture brief.",
		parameters: Type.Object({ queries: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { minItems: 1, maxItems: 3 }) }),
		execute: async (_id, { queries }, _signal, _update, ctx) => result(await get(ctx).scout(queries)),
	});
	pi.registerTool({
		name: "save_or_update_plan", label: "Autopilot plan", defaultActive: false, executionMode: "sequential",
		description: "After scouting, persist the complete task DAG. Every task needs an explicit authenticated model, exact file reservations, dependencies, and acceptance-test command. Only pending specifications may change; task state is controller-owned.",
		parameters: Type.Object({ tasks: Type.Array(TaskInputSchema, { minItems: 1, maxItems: 64 }) }),
		execute: async (_id, { tasks }, _signal, _update, ctx) => {
			await get(ctx).savePlan(tasks);
			return result("DAG saved atomically. Dispatch ready tasks.");
		},
	});
	pi.registerTool({
		name: "dispatch_subagents", label: "Autopilot workers", defaultActive: false, executionMode: "sequential",
		description: "Execute a ready, non-overlapping batch (at most three tasks). Omit taskIds to select automatically. Tests, independent review, rollback, up to three attempts, model escalation, quota fallback, and local Git checkpoints are automatic. Returns compact verified-task summaries.",
		parameters: Type.Object({ taskIds: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 3, uniqueItems: true })) }),
		execute: async (_id, { taskIds }, _signal, _update, ctx) => {
			try { return result(await get(ctx).dispatch(taskIds)); }
			finally { if (!engine?.enabled) restore(); }
		},
	});
	pi.on("tool_call", (event) => {
		if (engine?.enabled && !tools.includes(event.toolName)) return { block: true, reason: "The autonomous supervisor delegates repository work through autopilot tools only" };
	});
	pi.on("before_agent_start", (event, ctx) => {
		continuationQueued = false;
		context = ctx;
		if (engine?.enabled && engine.plan && engine.models) event.systemPromptOptions.sections.autopilot = supervisorPrompt(engine.plan, engine.models);
	});
	pi.on("turn_end", () => {
		engine?.supervisorTurnEnded();
		if (!engine?.enabled) restore();
	});
	pi.on("agent_end", async (event, ctx) => {
		if (!engine?.enabled) { restore(); return; }
		const errors = event.messages.filter((m) => m.role === "assistant" && m.stopReason === "error")
			.map((m) => "errorMessage" in m ? String(m.errorMessage) : "Supervisor provider error").join("\n");
		await engine.supervisorEnded(errors || undefined);
		if (engine.plan?.status === "paused_quota") engine.scheduleQuotaRetry(() => continueRun(ctx));
		else continueRun(ctx);
		if (!engine.enabled) restore();
	});
	pi.on("session_shutdown", async () => {
		if (engine?.enabled || engine?.busy) await engine.stop();
		unsubscribe?.();
		unsubscribe = undefined;
		restore();
		engine = undefined;
		context = undefined;
	});
}
