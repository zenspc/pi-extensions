import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { posix } from "node:path";

const choice = <T extends string>(values: T[]) => Type.Enum(values);
const text = (maxLength = 24_000) => Type.String({ minLength: 1, maxLength });
export const tiers = ["scout", "fast", "standard", "deep", "reviewer"] as const;
export type Tier = (typeof tiers)[number];
export const ModelId = Type.String({ pattern: "^[a-zA-Z0-9_.-]+/[^\\s]+$", maxLength: 300 });
export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ThinkingLevelSchema = choice([...thinkingLevels]);
export const TaskInputSchema = Type.Object({
	id: Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" }),
	title: text(300),
	description: text(),
	dependencies: Type.Array(text(64), { maxItems: 64, uniqueItems: true }),
	role: choice(["scout", "coder", "reviewer"]),
	complexityTier: choice(["scout", "fast", "standard", "deep"]),
	model: ModelId,
	thinkingLevel: ThinkingLevelSchema,
	allowedTools: text(200),
	filesToTouch: Type.Array(text(500), { maxItems: 200, uniqueItems: true }),
	verificationCommand: text(4000),
}, { additionalProperties: false });
export type TaskInput = Static<typeof TaskInputSchema>;
export const TaskSchema = Type.Object({
	...TaskInputSchema.properties,
	status: choice(["pending", "running", "verified", "failed", "paused_quota"]),
	retries: Type.Integer({ minimum: 0, maximum: 3 }),
	gitCheckpoint: Type.String(),
	resultSummary: Type.String({ maxLength: 2000 }),
	lastError: Type.String({ maxLength: 48_000 }),
	workspace: Type.Optional(Type.String()),
	candidateCommit: Type.Optional(Type.String({ pattern: "^[a-f0-9]{40,64}$" })),
	publishBase: Type.Optional(Type.String({ pattern: "^[a-f0-9]{40,64}$" })),
}, { additionalProperties: false });
export type Task = Static<typeof TaskSchema>;
export const PlanSchema = Type.Object({
	version: Type.Literal(1),
	runId: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
	root: text(4000),
	goal: text(),
	status: choice(["scouting", "planning", "running", "paused", "paused_quota", "blocked", "completed", "stopped"]),
	autoWait: Type.Boolean(),
	scoutBrief: Type.String({ maxLength: 6000 }),
	scoutsCompleted: Type.Integer({ minimum: 0, maximum: 3 }),
	totalSpawns: Type.Integer({ minimum: 0, maximum: 64 }),
	supervisorTurns: Type.Integer({ minimum: 0, maximum: 128 }),
	noProgressTurns: Type.Integer({ minimum: 0, maximum: 3 }),
	revision: Type.Integer({ minimum: 0 }),
	createdAt: text(100),
	updatedAt: text(100),
	lastError: Type.String({ maxLength: 48_000 }),
	workers: Type.Array(Type.Object({
		pid: Type.Integer({ minimum: 1 }), identity: Type.String(), token: Type.String(),
		taskId: Type.String(), model: Type.String(), workspace: Type.String(),
	}, { additionalProperties: false }), { maxItems: 6 }),
	tasks: Type.Array(TaskSchema, { maxItems: 64 }),
}, { additionalProperties: false });
export type Plan = Static<typeof PlanSchema>;
const RouteSchema = Type.Object({
	primary: ModelId,
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	fallbacks: Type.Array(ModelId, { maxItems: 10, uniqueItems: true }),
}, { additionalProperties: false });
export const ModelsSchema = Type.Object({
	version: Type.Literal(1),
	discoveredAt: text(100),
	available: Type.Array(ModelId, { minItems: 1, maxItems: 10_000, uniqueItems: true }),
	tiers: Type.Object(Object.fromEntries(tiers.map((tier) => [tier, RouteSchema])) as Record<Tier, typeof RouteSchema>, {
		additionalProperties: false,
	}),
}, { additionalProperties: false });
export type Models = Static<typeof ModelsSchema>;

export function validate<T extends TSchema>(schema: T, value: unknown): Static<T> {
	if (!Check(schema, value)) throw new Error("Invalid autopilot data: does not match the schema");
	return value as Static<T>;
}

export function safeFile(file: string): string {
	if (!file || file.includes("\\") || /[\x00-\x1f*?\[\]]/.test(file) ||
		posix.isAbsolute(file) || posix.normalize(file) !== file || file.split("/").includes("..") ||
		file.split("/").some((part) => part === ".git" || part === ".pi" || part === "node_modules") ||
		file.endsWith("/") || file === ".") {
		throw new Error(`Not an exact reservable repository file: ${file}`);
	}
	return file;
}

export function validateTasks(tasks: TaskInput[], models: Models): void {
	const ids = new Set(tasks.map((task) => task.id));
	if (ids.size !== tasks.length || !tasks.length) throw new Error("Plan needs unique task IDs and at least one task");
	const available = new Set(models.available);
	for (const task of tasks) {
		validate(TaskInputSchema, task);
		if (!available.has(task.model)) throw new Error(`Undiscovered model: ${task.model}`);
		for (const dep of task.dependencies) {
			if (!ids.has(dep) || dep === task.id) throw new Error(`Invalid dependency ${dep} for ${task.id}`);
		}
		task.filesToTouch.forEach(safeFile);
		if (task.role === "coder" && !task.filesToTouch.length) throw new Error("Coders need exact file reservations");
		if (task.role !== "coder" && task.filesToTouch.length) throw new Error("Read-only tasks cannot reserve writes");
		const allowed = task.role === "coder"
			? ["read", "write", "edit", "bash", "grep", "find", "ls"]
			: task.role === "reviewer" ? ["read", "grep", "bash"] : ["read", "grep", "find", "ls"];
		const tools = task.allowedTools.split(",");
		if (!tools.length || tools.some((tool) => !allowed.includes(tool))) throw new Error("Tools exceed role permissions");
	}
	const visited = new Set<string>();
	const visiting = new Set<string>();
	function visit(id: string): void {
		if (visiting.has(id)) throw new Error("Task dependencies contain a cycle");
		if (visited.has(id)) return;
		visiting.add(id);
		tasks.find((task) => task.id === id)!.dependencies.forEach(visit);
		visiting.delete(id);
		visited.add(id);
	}
	tasks.forEach((task) => visit(task.id));
}

export function readyBatch(tasks: Task[], requested?: string[]): Task[] {
	if (requested && new Set(requested).size !== requested.length) throw new Error("Duplicate task in batch");
	const candidates = requested
		? requested.map((id) => {
			const task = tasks.find((t) => t.id === id);
			if (!task) throw new Error(`Unknown task: ${id}`);
			return task;
		})
		: tasks.filter((task) => task.status === "pending");
	const selected: Task[] = [];
	const files = new Set<string>();
	for (const task of candidates) {
		const ready = task.status === "pending" && task.dependencies.every((dep) =>
			tasks.find((t) => t.id === dep)?.status === "verified");
		const overlaps = task.filesToTouch.some((file) => [...files].some((other) =>
			file === other || file.startsWith(other + "/") || other.startsWith(file + "/")));
		if (!ready || overlaps) {
			if (requested) throw new Error(`Task ${task.id} is not ready or overlaps another reservation`);
			continue;
		}
		if (selected.length === 3) {
			if (requested) throw new Error("At most three workers per batch");
			break;
		}
		selected.push(task);
		task.filesToTouch.forEach((file) => files.add(file));
	}
	return selected;
}
