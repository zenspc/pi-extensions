import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "./process.ts";
import { safeFile, type Plan, type Task } from "./schema.ts";

export function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function checkedPath(root: string, file: string, write = false): string {
	if (write) safeFile(file);
	const target = resolve(root, file);
	if (!within(root, target)) throw new Error(`Path escapes worktree: ${file}`);
	let current = root;
	for (const part of relative(root, target).split(sep).filter(Boolean)) {
		current = join(current, part);
		if (existsSync(current) || (() => { try { lstatSync(current); return true; } catch { return false; } })()) {
			if (lstatSync(current).isSymbolicLink() || !within(root, realpathSync(current))) {
				throw new Error(`Symlink paths are not allowed in workers: ${file}`);
			}
		}
	}
	return target;
}

export class Git {
	readonly root: string;
	readonly dir: string;
	constructor(root: string, dir: string) { this.root = root; this.dir = dir; }
	async command(cwd: string, args: string[], raw = false): Promise<string> {
		const hooks = join(this.dir, "empty-hooks");
		mkdirSync(hooks, { recursive: true, mode: 0o700 });
		const result = await runProcess("git", ["-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false", ...args], {
			cwd, durationMs: 120_000, inactivityMs: 120_000, outputLimit: 8 * 1024 * 1024, failOnOverflow: true,
			env: { GIT_PAGER: "cat", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
		});
		if (result.code) throw new Error(`git ${args[0]} failed: ${result.stderr || result.output}`);
		return raw ? result.output : result.output.trimEnd();
	}
	async head(cwd = this.root): Promise<string> { return this.command(cwd, ["rev-parse", "HEAD"]); }
	async assertRepository(): Promise<void> {
		if (realpathSync(await this.command(this.root, ["rev-parse", "--show-toplevel"])) !== this.root) {
			throw new Error("Start autopilot at the Git repository root");
		}
		await this.head();
		await this.command(this.root, ["var", "GIT_AUTHOR_IDENT"]);
		if ((await this.command(this.root, ["ls-files", "--", ".pi/autopilot"])).length) {
			throw new Error("Autopilot state must not be tracked in Git");
		}
		await this.assertClean();
	}
	async assertClean(): Promise<void> {
		const tracked = await this.command(this.root, ["status", "--porcelain=v1", "--untracked-files=no"]);
		const untracked = (await this.command(this.root, ["ls-files", "--others", "--exclude-standard", "-z"]))
			.split("\0").filter((file) => file && !file.startsWith(".pi/autopilot/"));
		if (tracked || untracked.length) throw new Error("Main checkout has user changes. Commit or stash them before autopilot/resume");
	}
	workspace(plan: Plan, id: string): string {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error("Invalid workspace ID");
		return checkedPath(this.dir, `worktrees/${plan.runId}/${id}`);
	}
	async create(plan: Plan, task: Task): Promise<string> {
		const path = this.workspace(plan, task.id);
		if (existsSync(path)) await this.remove(plan, task);
		task.gitCheckpoint = await this.head();
		mkdirSync(join(this.dir, "worktrees", plan.runId), { recursive: true, mode: 0o700 });
		await this.command(this.root, ["worktree", "add", "--detach", path, task.gitCheckpoint]);
		task.workspace = path;
		return path;
	}
	async remove(plan: Plan, task: Task): Promise<void> {
		const path = this.workspace(plan, task.id);
		if (task.workspace && task.workspace !== path) throw new Error("Refusing to remove a foreign worktree");
		if (existsSync(path)) {
			if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error("Unsafe worktree cleanup path");
			const registered = await this.command(this.root, ["worktree", "list", "--porcelain"]);
			if (!registered.split("\n").includes(`worktree ${path}`)) throw new Error("Workspace is not a registered worktree");
			await this.command(this.root, ["worktree", "remove", "--force", path]);
		}
		delete task.workspace;
	}
	async validateChanges(task: Task): Promise<string> {
		const cwd = task.workspace!;
		if (await this.head(cwd) !== task.gitCheckpoint) throw new Error("Worker changed its Git checkpoint");
		const changed = (await this.command(cwd, ["diff", "--name-only", "-z", task.gitCheckpoint, "--"]))
			.split("\0").filter(Boolean);
		const untracked = (await this.command(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
			.split("\0").filter(Boolean);
		const files = [...new Set([...changed, ...untracked])];
		for (const file of files) {
			if (!task.filesToTouch.includes(file)) throw new Error(`File reservation violation: ${file}`);
			checkedPath(cwd, file, true);
		}
		// Intent-to-add includes newly created files in the diff reviewed and tested below.
		if (untracked.length) await this.command(cwd, ["add", "--intent-to-add", "--", ...untracked]);
		return this.command(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--binary", task.gitCheckpoint, "--"], true);
	}
	async refreshBase(task: Task): Promise<void> {
		const head = await this.head();
		if (head === task.gitCheckpoint) return;
		const diff = await this.validateChanges(task);
		const patch = join(this.dir, `patch-${randomUUID()}`);
		try {
			writeFileSync(patch, diff, { flag: "wx", mode: 0o600 });
			await this.command(task.workspace!, ["reset", "--hard", head]);
			task.gitCheckpoint = head;
			if (diff) await this.command(task.workspace!, ["apply", "--index", "--binary", patch]);
		} finally { rmSync(patch, { force: true }); }
	}
	marker(plan: Plan, task: Task): string { return `Autopilot ${plan.runId}/${task.id}`; }
	async candidate(plan: Plan, task: Task): Promise<string> {
		await this.validateChanges(task);
		if (task.filesToTouch.length) {
			await this.command(task.workspace!, ["add", "-A", "--", ...task.filesToTouch]);
			const modes = await this.command(task.workspace!, ["ls-files", "--stage", "--", ...task.filesToTouch]);
			if (modes.split("\n").some((line) => /^(120000|160000) /.test(line))) throw new Error("Symlink and submodule edits are not publishable");
		}
		await this.command(task.workspace!, ["commit", "--allow-empty", "--no-verify", "-m", this.marker(plan, task)]);
		return this.head(task.workspace);
	}
	async publish(plan: Plan, task: Task): Promise<string> {
		await this.assertClean();
		const tracked = new Set(task.filesToTouch.length ? (await this.command(this.root, ["ls-files", "-z", "--", ...task.filesToTouch])).split("\0") : []);
		for (const file of task.filesToTouch) {
			const path = checkedPath(this.root, file, true);
			if (existsSync(path) && !tracked.has(file)) throw new Error(`Publication would overwrite an untracked or ignored user file: ${file}`);
		}
		if (await this.head() !== task.publishBase) throw new Error("Main HEAD changed during publication");
		await this.command(this.root, ["cherry-pick", "--allow-empty", "--keep-redundant-commits", task.candidateCommit!]);
		return this.head();
	}
	async recoverPublication(plan: Plan, task: Task): Promise<string | undefined> {
		if (!task.candidateCommit || !task.publishBase) return;
		const found = await this.command(this.root, ["log", "--format=%H", "--fixed-strings", `--grep=${this.marker(plan, task)}`, `${task.publishBase}..HEAD`]);
		if (found) return found.split("\n")[0];
		let inProgress = "";
		try { inProgress = await this.command(this.root, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"]); } catch { /* No interrupted cherry-pick. */ }
		if (inProgress === task.candidateCommit) await this.command(this.root, ["cherry-pick", "--abort"]);
	}
}
