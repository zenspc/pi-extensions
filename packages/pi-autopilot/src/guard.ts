import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { checkedPath } from "./git.ts";

export type WorkerPolicy = {
	root: string;
	role: "scout" | "coder" | "reviewer";
	files: string[];
	tools: string[];
	base: string;
};

export function guardTool(policy: WorkerPolicy, name: string, input: Record<string, unknown>): void {
	if (!policy.tools.includes(name)) throw new Error(`Worker tool not allowed: ${name}`);
	if (name === "write" || name === "edit") {
		if (policy.role !== "coder" || typeof input.path !== "string" || !policy.files.includes(input.path)) {
			throw new Error("Write is outside the exact file reservation");
		}
		checkedPath(policy.root, input.path, true);
	} else if (["read", "grep", "find", "ls"].includes(name)) {
		const path = input.path ?? ".";
		if (typeof path !== "string") throw new Error("Invalid read path");
		checkedPath(policy.root, path);
	} else if (name === "bash" && policy.role !== "coder") {
		const command = `git diff --no-ext-diff --no-textconv ${policy.base} -- .`;
		if (input.command !== command) throw new Error(`Reviewer bash is restricted to: ${command}`);
	}
}

export default function workerGuard(pi: ExtensionAPI): void {
	const raw = process.env.PI_AUTOPILOT_POLICY;
	if (!raw) throw new Error("The worker guard must only be loaded by autopilot");
	const policy = JSON.parse(raw) as WorkerPolicy;
	if (realpathSync(process.cwd()) !== policy.root || !/^[a-f0-9]{40,64}$/.test(policy.base)) {
		throw new Error("Invalid worker policy");
	}
	let lifeline: ReturnType<typeof setInterval> | undefined;
	pi.on("session_start", () => {
		const parent = Number(process.env.PI_AUTOPILOT_PARENT);
		if (!Number.isInteger(parent) || parent <= 0) throw new Error("Invalid autopilot parent PID");
		lifeline = setInterval(() => {
			try { process.kill(parent, 0); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") {
					process.kill(process.platform === "win32" ? process.pid : -process.pid, "SIGKILL");
				}
			}
		}, 1000);
		lifeline.unref();
	});
	pi.on("session_shutdown", () => { if (lifeline) clearInterval(lifeline); });
	pi.on("tool_call", (event) => {
		try { guardTool(policy, event.toolName, event.input); }
		catch (error) { return { block: true, reason: String(error) }; }
	});
}
