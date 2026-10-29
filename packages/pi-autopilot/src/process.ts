import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export class QuotaError extends Error {}
export class StoppedError extends Error {}
export class SpawnLimitError extends Error {}
export const quotaPattern = /\b429\b|rate[_ -]?limit|insufficient[_ -]?quota|\bquota\b|usage[_ -]?(?:cap|limit)|overloaded/i;
const clip = (text: string, limit = 32_000) => text.length <= limit ? text : text.slice(-limit);

export function processIdentity(pid: number): string {
	try {
		if (process.platform === "linux") {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
		}
		return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 5000 }).trim();
	} catch { return ""; }
}

export async function terminateRecorded(worker: { pid: number; identity: string; token: string }, guardPath: string): Promise<void> {
	if (!worker.identity || processIdentity(worker.pid) !== worker.identity) return;
	let command: string;
	try {
		command = process.platform === "linux" ? readFileSync(`/proc/${worker.pid}/cmdline`, "utf8")
			: execFileSync("ps", ["-p", String(worker.pid), "-o", "command="], { encoding: "utf8", timeout: 5000 });
	} catch { return; }
	if (!command.includes(guardPath)) throw new Error("Refusing to terminate a process without the autopilot guard");
	if (process.platform === "linux" && !readFileSync(`/proc/${worker.pid}/environ`, "utf8").split("\0").includes(`PI_AUTOPILOT_TOKEN=${worker.token}`)) {
		throw new Error("Recorded worker process token does not match");
	}
	const kill = (signal: NodeJS.Signals) => {
		try { process.kill(-worker.pid, signal); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
	};
	kill("SIGTERM");
	await new Promise<void>((resolve) => setTimeout(resolve, 2000));
	const identity = processIdentity(worker.pid);
	if (!identity || identity === worker.identity) kill("SIGKILL");
}

export class LoopDetector {
	private calls: string[] = [];
	add(name: string, args: unknown): boolean {
		const hash = createHash("sha256").update(name + "\0" + JSON.stringify(args)).digest("hex");
		this.calls.push(hash);
		this.calls = this.calls.slice(-12);
		for (let width = 1; width <= 3; width++) {
			if (this.calls.length < width * 4) continue;
			const tail = this.calls.slice(-width * 4);
			if (tail.every((value, i) => value === tail[i % width])) return true;
		}
		return false;
	}
}

export type ProcessOptions = {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	json?: boolean;
	inactivityMs?: number;
	durationMs?: number;
	killGraceMs?: number;
	maxTurns?: number;
	outputLimit?: number;
	failOnOverflow?: boolean;
	onSpawn?: (pid: number) => void;
};
export type ProcessResult = { code: number; output: string; stderr: string; text: string; turns: number };

export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
	if (options.signal?.aborted) return Promise.reject(new StoppedError("Autopilot stopped"));
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd, env: { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0", ...options.env },
			detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "", stderr = "", text = "", pending = "", turns = 0;
		let failure: Error | undefined;
		let closed = false;
		let lastBytes = Date.now();
		const start = lastBytes;
		const decoder = new StringDecoder("utf8");
		const errDecoder = new StringDecoder("utf8");
		const loops = new LoopDetector();
		const callIds = new Set<string>();
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		function kill(signal: NodeJS.Signals): void {
			if (!child.pid) return;
			try {
				if (process.platform === "win32") child.kill(signal);
				else process.kill(-child.pid, signal);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure ??= error as Error;
			}
		}
		function stop(error: Error): void {
			if (failure || closed) return;
			failure = error;
			kill("SIGTERM");
			killTimer = setTimeout(() => kill("SIGKILL"), options.killGraceMs ?? 2000);
		}
		const abort = () => stop(new StoppedError("Autopilot stopped"));
		options.signal?.addEventListener("abort", abort, { once: true });
		const watchdog = setInterval(() => {
			const now = Date.now();
			if (now - lastBytes >= (options.inactivityMs ?? 300_000)) stop(new Error("Worker stdout inactive for five minutes"));
			if (now - start >= (options.durationMs ?? 600_000)) stop(new Error("Worker exceeded total duration limit"));
		}, Math.min(1000, options.inactivityMs ?? 300_000, options.durationMs ?? 600_000));

		function event(line: string): void {
			if (line.length > 2 * 1024 * 1024) { stop(new Error("Oversized worker JSON record")); return; }
			if (!line.trim()) return;
			let e: Record<string, any>;
			try { e = JSON.parse(line); } catch { stop(new Error("Malformed JSON worker event")); return; }
			if (!e || typeof e !== "object") { stop(new Error("Invalid worker event")); return; }
			const errorMessage = e.errorMessage ?? e.finalError ?? e.message?.errorMessage ??
				(e.type === "error" ? e.error : undefined);
			if (errorMessage && quotaPattern.test(String(errorMessage))) {
				stop(new QuotaError(clip(String(errorMessage))));
				return;
			}
			if (e.type === "turn_start" && ++turns > (options.maxTurns ?? 30)) stop(new Error("Worker exceeded maxTurns: 30"));
			if (e.type === "tool_execution_start" || e.type === "tool_call") {
				const id = e.toolCallId ?? e.id;
				if (!id || !callIds.has(id)) {
					if (id) callIds.add(id);
					if (loops.add(e.toolName ?? e.name, e.args ?? e.arguments)) stop(new Error("Repeated tool-call loop detected"));
				}
			}
			if (e.type === "message_end" && e.message?.role === "assistant") {
				if (["error", "aborted"].includes(e.message.stopReason)) {
					stop(new Error(clip(e.message.errorMessage || "Worker assistant aborted")));
				}
				text = clip((e.message.content ?? []).filter((c: any) => c.type === "text")
					.map((c: any) => c.text).join("\n"), 24_000);
			}
			if (e.type === "agent_settled" && e.aborted) stop(new Error("Worker run aborted"));
		}
		function consume(chunk: string): void {
			pending += chunk;
			let newline: number;
			while ((newline = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, newline).replace(/\r$/, "");
				pending = pending.slice(newline + 1);
				event(line);
			}
			if (pending.length > 2 * 1024 * 1024) stop(new Error("Oversized worker JSON record"));
		}
		child.stdout.on("data", (bytes: Buffer) => {
			lastBytes = Date.now();
			const chunk = decoder.write(bytes);
			const limit = options.outputLimit ?? 32_000;
			if (options.failOnOverflow && output.length + chunk.length > limit) stop(new Error("Process output exceeds safe capture limit"));
			output = clip(output + chunk, limit);
			if (options.json) consume(chunk);
		});
		child.stderr.on("data", (bytes: Buffer) => {
			stderr = clip(stderr + errDecoder.write(bytes));
			if (options.json && quotaPattern.test(stderr)) stop(new QuotaError(stderr));
		});
		child.on("spawn", () => {
			try { if (child.pid) options.onSpawn?.(child.pid); }
			catch (error) { stop(error as Error); }
		});
		child.on("error", (error) => { failure ??= error; });
		child.on("close", (code) => {
			if (options.json) {
				consume(decoder.end());
				if (pending.trim()) event(pending);
			} else output = clip(output + decoder.end());
			stderr = clip(stderr + errDecoder.end());
			closed = true;
			clearInterval(watchdog);
			if (killTimer) clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", abort);
			// A successful shell/agent must not leave background servers alive in its process group.
			kill("SIGKILL");
			if (failure) reject(failure);
			else if (options.json && (code !== 0 || !text.trim())) reject(new Error(clip(stderr || output || "Worker returned no result")));
			else resolve({ code: code ?? 1, output, stderr, text, turns });
		});
	});
}
