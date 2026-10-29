import { randomUUID } from "node:crypto";
import {
	closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
	realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ModelsSchema, PlanSchema, validate, type Models, type Plan } from "./schema.ts";

export function stateDirectory(root: string): string {
	for (const path of [join(root, ".pi"), join(root, ".pi", "autopilot")]) {
		if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) {
			throw new Error(`Autopilot state directory must not be a symlink: ${path}`);
		}
		mkdirSync(path, { recursive: true, mode: 0o700 });
	}
	return join(root, ".pi", "autopilot");
}

export function atomicJson(path: string, value: unknown): void {
	const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
	let fd: number | undefined;
	try {
		fd = openSync(tmp, "wx", 0o600);
		writeFileSync(fd, JSON.stringify(value, null, "\t") + "\n");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(tmp, path);
		// Flush the rename as well as the file contents on platforms supporting directory fsync.
		if (process.platform !== "win32") {
			const dir = openSync(dirname(path), "r");
			try { fsyncSync(dir); } finally { closeSync(dir); }
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
		rmSync(tmp, { force: true });
	}
}

export function readJson(path: string): unknown {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) {
		throw new Error(`Unsafe or oversized state file: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

export class Store {
	readonly root: string;
	readonly dir: string;
	private token?: string;
	constructor(root: string) {
		this.root = realpathSync(resolve(root));
		this.dir = stateDirectory(this.root);
	}

	acquire(): void {
		if (this.token) return;
		const path = join(this.dir, "lock.json");
		const token = randomUUID();
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const fd = openSync(path, "wx", 0o600);
				try {
					writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
					fsyncSync(fd);
				} finally { closeSync(fd); }
				this.token = token;
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				const lock = readJson(path) as { pid?: number };
				if (!Number.isInteger(lock.pid) || lock.pid! <= 0) throw new Error("Invalid autopilot lock; refusing takeover");
				try {
					process.kill(lock.pid!, 0);
					throw new Error("Another autopilot controller owns this repository");
				} catch (probe) {
					if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
				}
				// Serialize stale-lock reaping so two recovering controllers cannot unlink each other's new lock.
				const reaper = path + ".reap";
				const fd = openSync(reaper, "wx", 0o600);
				try {
					if (JSON.stringify(readJson(path)) !== JSON.stringify(lock)) throw new Error("Autopilot lock changed during recovery");
					rmSync(path);
				} finally { closeSync(fd); rmSync(reaper, { force: true }); }
			}
		}
		throw new Error("Could not acquire autopilot lock");
	}

	release(): void {
		if (!this.token) return;
		const path = join(this.dir, "lock.json");
		if (existsSync(path) && (readJson(path) as { token?: string }).token === this.token) rmSync(path);
		this.token = undefined;
	}

	load(): Plan | undefined {
		const path = ["run.json", "plan.json"].map((name) => join(this.dir, name)).find(existsSync);
		if (!path) return;
		const plan = validate(PlanSchema, readJson(path));
		if (plan.root !== this.root) throw new Error("Saved plan belongs to a different repository");
		return plan;
	}

	save(plan: Plan): void {
		if (!this.token) throw new Error("State writes require the repository lock");
		plan.updatedAt = new Date().toISOString();
		plan.revision++;
		validate(PlanSchema, plan);
		const planned = plan.tasks.length > 0;
		atomicJson(join(this.dir, planned ? "plan.json" : "run.json"), plan);
		if (planned) rmSync(join(this.dir, "run.json"), { force: true });
	}

	models(): Models {
		const models = validate(ModelsSchema, readJson(join(this.dir, "models.json")));
		for (const route of Object.values(models.tiers)) {
			if ([route.primary, ...route.fallbacks].some((id) => !models.available.includes(id))) {
				throw new Error("Configured route contains an undiscovered model; run /autopilot-models");
			}
		}
		return models;
	}
}
