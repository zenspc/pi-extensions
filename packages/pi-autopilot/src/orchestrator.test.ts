import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { Orchestrator } from "./orchestrator.ts";
import { QuotaError, StoppedError, runProcess, type ProcessOptions, type ProcessResult } from "./process.ts";
import { atomicJson } from "./state.ts";
import { input, models } from "./test-support.ts";

type Call = { args: string[]; options: ProcessOptions; policy: { role: string; files: string[] } };
type Handler = (call: Call) => Promise<ProcessResult | void>;
const ok = (text: string): ProcessResult => ({ code: 0, output: "", stderr: "", text, turns: 1 });
function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function fixture(t: TestContext, handler?: Handler) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "autopilot-engine-")));
	git(root, "init", "-q");
	git(root, "config", "user.name", "Dhairya");
	git(root, "config", "user.email", "autopilot-tests@example.invalid");
	git(root, "config", "commit.gpgsign", "false");
	writeFileSync(join(root, "README.md"), "fixture\n");
	writeFileSync(join(root, ".gitignore"), ".pi/\n");
	git(root, "add", "."); git(root, "commit", "-qm", "fixture");
	const calls: Call[] = [];
	const runner: typeof runProcess = async (command, args, options) => {
		if (!options.json) return runProcess(command, args, options);
		const policy = JSON.parse(options.env!.PI_AUTOPILOT_POLICY!);
		const call = { args, options, policy }; calls.push(call);
		const custom = await handler?.(call);
		if (custom) return custom;
		if (policy.role === "scout") return ok("README.md documents the architecture. Use test -f for the fixture acceptance command.");
		if (policy.role === "reviewer") return ok(JSON.stringify({ pass: true, summary: "Inspected the complete diff against the acceptance criteria" }));
		for (const file of policy.files) writeFileSync(join(options.cwd, file), "correct\n");
		return ok("Implemented the task and regression check");
	};
	const engine = new Orchestrator(root, { runner });
	atomicJson(join(engine.store.dir, "models.json"), models);
	t.after(async () => {
		if (engine.enabled || engine.busy) await engine.stop();
		rmSync(root, { recursive: true, force: true });
	});
	await engine.start("Implement the fixture goal");
	return { root, engine, calls, runner };
}

test("Phase 0 precedes the DAG, verified dependencies gate parallel isolated workers", async (t) => {
	let concurrent = 0, maximum = 0;
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => { release = resolve; });
	const { root, engine, calls } = await fixture(t, async ({ policy }) => {
		if (policy.role === "coder" && policy.files[0] !== "c.txt") {
			concurrent++; maximum = Math.max(maximum, concurrent);
			if (concurrent === 2) release();
			await barrier; concurrent--;
		}
		return undefined;
	});
	await assert.rejects(engine.savePlan([input()]), /run_scouts/);
	assert.equal(existsSync(join(engine.store.dir, "plan.json")), false);
	assert.equal(existsSync(join(engine.store.dir, "run.json")), true);
	await engine.scout(["architecture", "tests"]);
	await assert.rejects(engine.scout(["again"]), /already/);
	await engine.savePlan([input("a", { verificationCommand: "test -f a.txt" }), input("b", { verificationCommand: "test -f a.txt && test -f b.txt" }), input("c", { dependencies: ["a", "b"], verificationCommand: "test -f a.txt && test -f b.txt && test -f c.txt" })]);
	assert.equal(existsSync(join(engine.store.dir, "plan.json")), true);
	assert.equal(existsSync(join(engine.store.dir, "run.json")), false);
	await assert.rejects(engine.dispatch(["c"]), /not ready/);
	const summaries = await engine.dispatch(["a", "b"]);
	assert.equal(summaries.length, 2);
	assert.equal(maximum, 2);
	assert.ok(calls.filter((c) => c.policy.role === "coder").every((c) => c.options.cwd !== root));
	await engine.dispatch(["c"]);
	assert.equal(engine.plan!.status, "completed");
	assert.equal(engine.enabled, false);
	assert.equal(engine.plan!.tasks.filter((task) => task.status === "verified").length, 3);
	assert.equal(git(root, "status", "--porcelain"), "");
	assert.equal(git(root, "rev-list", "--count", "HEAD"), "4");
	for (const { args, options } of calls) {
		for (const flag of ["--no-session", "--model", "--thinking", "--tools", "--no-extensions", "--no-mcp"]) assert.ok(args.includes(flag));
		assert.ok(args[args.indexOf("--model") + 1].includes("/"));
		assert.equal(options.json, true);
	}
	assert.equal(git(root, "worktree", "list", "--porcelain").split("worktree ").length, 2);
});

test("failed verification rolls back to a clean checkpoint and escalates attempts 2/3", async (t) => {
	let attempt = 0;
	const { root, engine, calls } = await fixture(t, async ({ policy, options, args }) => {
		if (policy.role !== "coder") return;
		attempt++;
		assert.equal(existsSync(join(options.cwd, "task-1.txt")), false, "retry must not inherit a broken file");
		if (attempt === 2) {
			assert.equal(args[args.indexOf("--model") + 1], "frontier/deep");
			assert.equal(args[args.indexOf("--thinking") + 1], "high");
			assert.match(args.at(-1)!, /Verification failed/);
			assert.match(args.at(-1)!, /broken/);
		}
		writeFileSync(join(options.cwd, "task-1.txt"), attempt === 1 ? "broken\n" : "correct\n");
		return ok("Implemented candidate");
	});
	await engine.scout(["tests"]);
	await engine.savePlan([input("task-1", { verificationCommand: "grep -q correct task-1.txt" })]);
	await engine.dispatch();
	assert.equal(attempt, 2);
	assert.equal(engine.plan!.tasks[0].retries, 1);
	assert.equal(engine.plan!.tasks[0].status, "verified");
	assert.equal(calls.filter((c) => c.policy.role === "reviewer").length, 1);
	assert.equal(readFileSync(join(root, "task-1.txt"), "utf8"), "correct\n");
});

test("configured thinking levels survive reload and apply to every tier, quota fallback, and escalation", async (t) => {
	let attempts = 0;
	const { engine, calls } = await fixture(t, async ({ policy, options, args }) => {
		if (policy.role !== "coder" || policy.files[0] !== "fast-task.txt") return;
		if (args[args.indexOf("--model") + 1] === "cheap/fast") throw new QuotaError("429 quota");
		writeFileSync(join(options.cwd, "fast-task.txt"), ++attempts === 1 ? "broken\n" : "correct\n");
		return ok("Implemented candidate");
	});
	const configured = structuredClone(models);
	configured.tiers.scout.thinkingLevel = "minimal";
	configured.tiers.fast.thinkingLevel = "medium";
	configured.tiers.standard.thinkingLevel = "high";
	configured.tiers.deep.thinkingLevel = "xhigh";
	configured.tiers.reviewer.thinkingLevel = "max";
	atomicJson(join(engine.store.dir, "models.json"), configured);
	await engine.pause();
	await engine.resume(false);
	await engine.scout(["tests"]);
	await engine.savePlan([
		input("fast-task", { thinkingLevel: "off", verificationCommand: "grep -q correct fast-task.txt" }),
		input("standard-task", { complexityTier: "standard", thinkingLevel: "off", dependencies: ["fast-task"], verificationCommand: "test -f standard-task.txt" }),
	]);
	await engine.dispatch(["fast-task"]);
	await engine.dispatch(["standard-task"]);
	assert.equal(engine.plan!.status, "completed");
	const thinking = (call: Call) => call.args[call.args.indexOf("--thinking") + 1];
	assert.deepEqual(calls.filter((call) => call.policy.role === "scout").map(thinking), ["minimal"]);
	assert.deepEqual(calls.filter((call) => call.policy.role === "coder").map(thinking), ["medium", "medium", "xhigh", "high"]);
	assert.deepEqual(calls.filter((call) => call.policy.role === "reviewer").map(thinking), ["max", "max"]);
	assert.equal(engine.store.load()!.tasks[0].thinkingLevel, "xhigh");
	assert.equal(engine.store.load()!.tasks[1].thinkingLevel, "high");
});

test("reviewer rejection triggers rollback and retry even when tests passed", async (t) => {
	let reviews = 0;
	const { root, engine } = await fixture(t, async ({ policy }) => {
		if (policy.role === "reviewer" && ++reviews === 1) return ok('{"pass":false,"summary":"Missing regression assertion; do not delete tests"}');
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]); await engine.dispatch();
	assert.equal(reviews, 2);
	assert.equal(engine.plan!.tasks[0].retries, 1);
	assert.equal(git(root, "rev-list", "--count", "HEAD"), "2");
});

test("three hard failures block the run without leaking files or checkpoint commits", async (t) => {
	const { root, engine } = await fixture(t);
	const before = git(root, "rev-parse", "HEAD");
	await engine.scout(["tests"]);
	await engine.savePlan([input("task-1", { verificationCommand: "echo exact-failure >&2; exit 2" })]);
	await engine.dispatch();
	assert.equal(engine.plan!.status, "blocked");
	assert.equal(engine.plan!.tasks[0].retries, 3);
	assert.equal(engine.plan!.tasks[0].status, "failed");
	assert.match(engine.plan!.tasks[0].lastError, /exact-failure/);
	assert.equal(engine.enabled, false);
	assert.equal(existsSync(join(root, "task-1.txt")), false);
	assert.equal(git(root, "rev-parse", "HEAD"), before);
	await engine.resume(false);
	assert.equal(engine.plan!.status, "blocked", "resume must not reset the failure safety ceiling");
});

test("out-of-reservation changes never reach the main checkout", async (t) => {
	const { root, engine } = await fixture(t, async ({ policy, options }) => {
		if (policy.role === "coder") { writeFileSync(join(options.cwd, "rogue.txt"), "unauthorized"); return ok("done"); }
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]); await engine.dispatch();
	assert.equal(engine.plan!.status, "blocked");
	assert.match(engine.plan!.tasks[0].lastError, /reservation violation/);
	assert.equal(existsSync(join(root, "rogue.txt")), false);
});

test("a reviewer that writes files is rejected even if it claims to pass", async (t) => {
	const { root, engine } = await fixture(t, async ({ policy, options }) => {
		if (policy.role === "reviewer") writeFileSync(join(options.cwd, "task-1.txt"), "reviewer tampering\n");
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]); await engine.dispatch();
	assert.equal(engine.plan!.status, "blocked");
	assert.match(engine.plan!.tasks[0].lastError, /reviewer modified/);
	assert.equal(existsSync(join(root, "task-1.txt")), false);
});

test("provider quota fallback changes the explicit model without consuming a verification retry", async (t) => {
	const { engine, calls } = await fixture(t, async ({ policy, args }) => {
		if (policy.role === "coder" && args[args.indexOf("--model") + 1] === "cheap/fast") throw new QuotaError("429 rate_limit");
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]); await engine.dispatch();
	assert.equal(engine.plan!.status, "completed");
	assert.equal(engine.plan!.tasks[0].retries, 0);
	assert.equal(engine.plan!.tasks[0].model, "backup/fast");
	assert.deepEqual(calls.filter((c) => c.policy.role === "coder").map((c) => c.args[c.args.indexOf("--model") + 1]), ["cheap/fast", "backup/fast"]);
});

test("quota exhaustion persists paused tasks and auto-wait resumes without resetting spawn totals", async (t) => {
	let limited = true;
	const { engine } = await fixture(t, async ({ policy }) => {
		if (limited && policy.role === "coder") throw new QuotaError("quota exhausted");
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]); await engine.dispatch();
	assert.equal(engine.plan!.status, "paused_quota");
	assert.equal(engine.plan!.tasks[0].status, "paused_quota");
	assert.equal(engine.enabled, false);
	const spawns = engine.plan!.totalSpawns;
	await engine.resume(true);
	await engine.dispatch();
	assert.equal(engine.plan!.status, "paused_quota");
	assert.equal(engine.enabled, true);
	limited = false;
	await new Promise<void>((resolve) => { engine.scheduleQuotaRetry(resolve, 1); });
	assert.equal(engine.plan!.status, "running");
	await engine.dispatch();
	assert.equal(engine.plan!.status, "completed");
	assert.ok(engine.plan!.totalSpawns > spawns);
});

test("pause finishes the active batch but leaves remaining tasks for resume", async (t) => {
	let release!: () => void, started!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const active = new Promise<void>((resolve) => { started = resolve; });
	const { engine } = await fixture(t, async ({ policy }) => {
		if (policy.role === "coder" && policy.files[0] === "a.txt") { started(); await gate; }
	});
	await engine.scout(["tests"]);
	await engine.savePlan([input("a", { verificationCommand: "test -f a.txt" }), input("b", { dependencies: ["a"], verificationCommand: "test -f b.txt" })]);
	const dispatch = engine.dispatch(["a"]);
	await active; await engine.pause(); release(); await dispatch;
	assert.equal(engine.plan!.status, "paused");
	assert.equal(engine.plan!.tasks[0].status, "verified");
	assert.equal(engine.plan!.tasks[1].status, "pending");
	assert.equal(engine.enabled, false);
	await engine.resume(false); await engine.dispatch();
	assert.equal(engine.plan!.status, "completed");
});

test("stop aborts active work and saves clean pending state", async (t) => {
	let started!: () => void;
	const active = new Promise<void>((resolve) => { started = resolve; });
	const { root, engine } = await fixture(t, async ({ policy, options }) => {
		if (policy.role === "coder") {
			writeFileSync(join(options.cwd, "task-1.txt"), "partial"); started();
			await new Promise((_, reject) => options.signal!.addEventListener("abort", () => reject(new StoppedError("stopped")), { once: true }));
		}
	});
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	const dispatch = engine.dispatch(); await active; await engine.stop(); await dispatch;
	assert.equal(engine.plan!.status, "stopped");
	assert.equal(engine.plan!.tasks[0].status, "pending");
	assert.equal(engine.plan!.tasks[0].retries, 0);
	assert.equal(existsSync(join(root, "task-1.txt")), false);
});

test("resume repairs a crash between publication and the verified-state write", async (t) => {
	const { root, engine, runner } = await fixture(t);
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	const task = engine.plan!.tasks[0];
	task.status = "running";
	await engine.git.create(engine.plan!, task);
	writeFileSync(join(task.workspace!, "task-1.txt"), "correct\n");
	task.candidateCommit = await engine.git.candidate(engine.plan!, task);
	task.publishBase = await engine.git.head();
	engine.store.save(engine.plan!);
	const published = await engine.git.publish(engine.plan!, task);
	engine.store.release(); engine.enabled = false;
	const restored = new Orchestrator(root, { runner });
	await restored.resume(false);
	assert.equal(restored.plan!.tasks[0].status, "verified");
	assert.equal(restored.plan!.tasks[0].gitCheckpoint, published);
	assert.equal(restored.plan!.status, "completed");
	assert.equal(restored.enabled, false);
	assert.equal(git(root, "rev-list", "--count", "HEAD"), "2");
	restored.store.acquire(); restored.plan!.totalSpawns = 64; restored.store.save(restored.plan!); restored.store.release();
	await restored.resume(false);
	assert.equal(restored.plan!.status, "completed", "a completed run remains complete even at its spawn ceiling");
});

test("resume removes an interrupted worktree and does not retain half-broken code", async (t) => {
	const { root, engine, runner } = await fixture(t);
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	const task = engine.plan!.tasks[0]; task.status = "running";
	await engine.git.create(engine.plan!, task);
	writeFileSync(join(task.workspace!, "task-1.txt"), "half broken");
	engine.store.save(engine.plan!); engine.store.release(); engine.enabled = false;
	const restored = new Orchestrator(root, { runner });
	t.after(async () => { if (restored.enabled) await restored.stop(); });
	await restored.resume(false);
	assert.equal(restored.plan!.tasks[0].status, "pending");
	assert.equal(restored.plan!.tasks[0].workspace, undefined);
	await restored.dispatch();
	assert.equal(restored.plan!.status, "completed");
	assert.equal(readFileSync(join(root, "task-1.txt"), "utf8"), "correct\n");
});

test("stop after a controller restart discards abandoned worktrees and records pending tasks", async (t) => {
	const { root, engine } = await fixture(t);
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	const task = engine.plan!.tasks[0]; task.status = "running";
	await engine.git.create(engine.plan!, task);
	const workspace = task.workspace!;
	writeFileSync(join(workspace, "task-1.txt"), "abandoned");
	engine.store.save(engine.plan!); engine.store.release(); engine.enabled = false;
	const restored = new Orchestrator(root);
	await restored.stop();
	assert.equal(restored.store.load()!.status, "stopped");
	assert.equal(restored.store.load()!.tasks[0].status, "pending");
	assert.equal(existsSync(workspace), false);
	assert.equal(existsSync(join(root, "task-1.txt")), false);
});

test("global spawn ceiling includes reviewers and survives resume; idle supervisors stop", async (t) => {
	const { root, engine } = await fixture(t);
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	engine.plan!.totalSpawns = 63;
	await engine.dispatch();
	assert.equal(engine.plan!.totalSpawns, 64);
	assert.equal(engine.plan!.status, "blocked");
	assert.equal(existsSync(join(root, "task-1.txt")), false);
	await engine.resume(false);
	assert.equal(engine.plan!.status, "blocked");
	const isolated = new Orchestrator(root);
	isolated.store.acquire(); isolated.plan = isolated.store.load()!;
	isolated.plan.totalSpawns = 0; isolated.plan.status = "running"; isolated.store.save(isolated.plan);
	isolated.store.release();
	await isolated.resume(false);
	await isolated.supervisorEnded(); await isolated.supervisorEnded(); await isolated.supervisorEnded();
	assert.equal(isolated.plan!.status, "blocked");
	assert.equal(isolated.enabled, false);
});

test("publication never overwrites concurrent user edits in the main checkout", async (t) => {
	const { root, engine } = await fixture(t);
	await engine.scout(["tests"]); await engine.savePlan([input()]);
	writeFileSync(join(root, "README.md"), "user's in-progress edit\n");
	await setImmediate();
	await engine.dispatch();
	assert.equal(engine.plan!.status, "blocked");
	assert.match(engine.plan!.tasks[0].lastError, /user changes/);
	assert.equal(readFileSync(join(root, "README.md"), "utf8"), "user's in-progress edit\n");
	assert.equal(existsSync(join(root, "task-1.txt")), false);
});
