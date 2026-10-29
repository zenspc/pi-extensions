import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardTool } from "./guard.ts";
import { parseModelList, candidates } from "./models.ts";
import { LoopDetector, QuotaError, StoppedError, runProcess } from "./process.ts";
import { TaskInputSchema, readyBatch, safeFile, validate, validateTasks, type Task } from "./schema.ts";
import { input, models } from "./test-support.ts";
import { atomicJson, readJson, Store } from "./state.ts";

function task(id: string, overrides: Partial<Task> = {}): Task {
	return { ...input(id), status: "pending", retries: 0, gitCheckpoint: "", resultSummary: "", lastError: "", ...overrides };
}

test("DAG validation rejects cycles, default model inheritance, unsafe files, and excess role tools", () => {
	validateTasks([input()], models);
	assert.throws(() => validateTasks([input("a", { dependencies: ["b"] }), input("b", { dependencies: ["a"] })], models), /cycle/);
	assert.throws(() => validateTasks([input("a", { dependencies: ["missing"] })], models), /dependency/);
	assert.throws(() => validateTasks([input("a", { model: "inherit-parent" })], models));
	assert.throws(() => validateTasks([input("a", { model: "other/unknown" })], models), /Undiscovered/);
	assert.throws(() => validate(TaskInputSchema, { ...input(), status: "verified" }));
	for (const file of ["../secret", "/tmp/file", "a/../b", "a//b", "a/", "*.ts", ".git/config", ".pi/settings.json", "node_modules/a", "a\\b", "a\nb"]) assert.throws(() => safeFile(file), file);
	assert.throws(() => validateTasks([input("a", { role: "scout", filesToTouch: [], allowedTools: "read,bash" })], models), /permissions/);
	assert.throws(() => validateTasks([input("a", { allowedTools: "+read" })], models), /permissions/);
});

test("ready batches require verified dependencies and exact non-overlapping reservations", () => {
	const tasks = [task("a"), task("b", { dependencies: ["a"] }), task("c", { filesToTouch: ["a.txt"] }), task("d"), task("e")];
	assert.deepEqual(readyBatch(tasks).map((t) => t.id), ["a", "d", "e"]);
	assert.throws(() => readyBatch(tasks, ["b"]), /not ready/);
	assert.throws(() => readyBatch(tasks, ["a", "c"]), /overlaps/);
	assert.throws(() => readyBatch(tasks, ["a", "a"]), /Duplicate/);
	tasks[0].status = "verified";
	assert.deepEqual(readyBatch(tasks, ["b"]).map((t) => t.id), ["b"]);
	assert.throws(() => readyBatch([task("a", { filesToTouch: ["src"] }), task("b", { filesToTouch: ["src/a.ts"] })], ["a", "b"]), /overlaps/);
});

test("atomic state files refuse symlinks and concurrent owners", () => {
	const root = mkdtempSync(join(tmpdir(), "autopilot-state-"));
	try {
		const store = new Store(root);
		const file = join(store.dir, "value.json");
		for (let n = 0; n < 20; n++) { atomicJson(file, { n }); assert.deepEqual(readJson(file), { n }); }
		store.acquire();
		assert.throws(() => new Store(root).acquire(), /owns/);
		store.release();
		const second = new Store(root); second.acquire(); second.release();
		symlinkSync(file, join(store.dir, "link.json"));
		assert.throws(() => readJson(join(store.dir, "link.json")), /Unsafe/);
		assert.equal(JSON.parse(readFileSync(file, "utf8")).n, 19);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("worker guard confines writes and reviewer bash, including symlink escapes", () => {
	const root = mkdtempSync(join(tmpdir(), "autopilot-guard-"));
	try {
		mkdirSync(join(root, "src"));
		const base = "a".repeat(40);
		const policy = { root, role: "coder" as const, files: ["src/a.ts"], tools: ["read", "write", "edit", "bash"], base };
		guardTool(policy, "write", { path: "src/a.ts" });
		assert.throws(() => guardTool(policy, "write", { path: "src/b.ts" }), /reservation/);
		assert.throws(() => guardTool(policy, "read", { path: "../outside" }), /escapes/);
		symlinkSync(tmpdir(), join(root, "src", "link"));
		assert.throws(() => guardTool({ ...policy, files: ["src/link/a.ts"] }, "write", { path: "src/link/a.ts" }), /Symlink/);
		const reviewer = { ...policy, role: "reviewer" as const, tools: ["read", "grep", "bash"], files: [] };
		guardTool(reviewer, "bash", { command: `git diff --no-ext-diff --no-textconv ${base} -- .` });
		for (const command of ["git diff; rm -rf .", "git diff --output=src/a.ts", "npm test", "echo pass"]) assert.throws(() => guardTool(reviewer, "bash", { command }), /restricted/);
		assert.throws(() => guardTool(reviewer, "write", { path: "src/a.ts" }), /not allowed/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("model discovery parses Pi's authenticated table without inheriting a default", () => {
	const ids = parseModelList("provider model context max-out thinking images\ncheap fast 200K 16K no yes\nfrontier deep 1M 64K yes yes\nWarning: no matching models\n");
	assert.deepEqual(ids, ["cheap/fast", "frontier/deep"]);
	assert.deepEqual(candidates(models, "deep"), ["frontier/deep", "backup/fast"]);
	assert.deepEqual(candidates(models, "fast", "backup/fast"), ["backup/fast", "cheap/fast"], "resume must retry the primary provider after a fallback also exhausts quota");
	assert.throws(() => candidates(models, "fast", "unknown/default"), /undiscovered/);
});

test("loop detector handles patterns of one to three calls, not reads of different files", () => {
	for (let width = 1; width <= 3; width++) {
		const detector = new LoopDetector();
		for (let i = 0; i < width * 4; i++) assert.equal(detector.add("read", { path: `file-${i % width}` }), i === width * 4 - 1);
	}
	const distinct = new LoopDetector();
	for (let i = 0; i < 30; i++) assert.equal(distinct.add("read", { path: `file-${i}` }), false);
});

const finalEvent = (text = "done") => JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } });
const run = (source: string, overrides = {}) => runProcess(process.execPath, ["-e", source], {
	cwd: tmpdir(), json: true, durationMs: 3000, inactivityMs: 2000, killGraceMs: 20, ...overrides,
});

test("JSON worker framing preserves Unicode separators and ignores tool results for loops", async () => {
	const events = Array.from({ length: 12 }, (_, i) => JSON.stringify({ type: "tool_execution_start", toolCallId: String(i), toolName: "read", args: { path: `file-${i}` } }));
	const results = Array.from({ length: 12 }, () => JSON.stringify({ type: "tool_result", toolName: "read", args: { path: "same" } }));
	const output = [...events, ...results, finalEvent("architecture \u2028 paths \u2029 tests")].join("\n") + "\n";
	const result = await run(`process.stdout.write(${JSON.stringify(output)})`);
	assert.equal(result.text, "architecture \u2028 paths \u2029 tests");
});

test("process circuit breakers terminate repeated calls, too many turns, silence, and duration", async () => {
	const loop = Array.from({ length: 4 }, (_, i) => JSON.stringify({ type: "tool_execution_start", toolCallId: String(i), toolName: "bash", args: { command: "false" } })).join("\n") + "\n";
	await assert.rejects(run(`process.stdout.write(${JSON.stringify(loop)});setInterval(()=>{},100)`), /loop detected/);
	const turns = Array.from({ length: 31 }, () => '{"type":"turn_start"}').join("\n") + "\n";
	await assert.rejects(run(`process.stdout.write(${JSON.stringify(turns)});setInterval(()=>{},100)`), /maxTurns/);
	await assert.rejects(run("process.stderr.write('still working');setInterval(()=>{},100)", { inactivityMs: 100 }), /inactive/);
	await assert.rejects(run("setInterval(()=>process.stdout.write('{\"type\":\"agent_start\"}\\n'),10)", { durationMs: 150 }), /duration/);
});

test("quota detection uses provider errors, not repository text mentioning quotas", async () => {
	const harmless = await run(`process.stdout.write(${JSON.stringify(finalEvent("Document quota and rate_limit handling") + "\n")})`);
	assert.match(harmless.text, /quota/);
	await assert.rejects(run("process.stderr.write('ra');setTimeout(()=>process.stderr.write('te_limit 429'),5);setInterval(()=>{},100)"), QuotaError);
	await assert.rejects(run(`console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'insufficient_quota'}}))`), QuotaError);
});

test("subprocesses are non-interactive and do not inherit terminal stdin", async () => {
	const result = await runProcess(process.execPath, ["-e", "process.stdout.write(process.env.CI + ':' + process.env.GIT_TERMINAL_PROMPT)"], { cwd: tmpdir() });
	assert.equal(result.output, "true:0");
});

test("workers honor stop, fail closed on malformed output and spawn errors, and bound capture", async () => {
	const controller = new AbortController();
	const promise = run("process.on('SIGTERM',()=>{});setInterval(()=>{},100)", { signal: controller.signal });
	setTimeout(() => controller.abort(), 100);
	await assert.rejects(promise, StoppedError);
	await assert.rejects(run("console.log('not json')"), /Malformed/);
	await assert.rejects(run("console.log(JSON.stringify({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'bad request'}}))"), /bad request/);
	await assert.rejects(runProcess("/definitely/missing/pi", [], { cwd: tmpdir() }), /ENOENT/);
	await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(2000))"], { cwd: tmpdir(), outputLimit: 100, failOnOverflow: true }), /capture limit/);
});
