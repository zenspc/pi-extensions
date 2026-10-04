/**
 * /cd and /pwd - change Pi's working directory by switching sessions.
 *
 * Pi binds tools, AGENTS.md, project settings, and the footer to the session cwd.
 * This extension prepares a session file under the target project and calls
 * ctx.switchSession so the host rebuilds cwd-bound runtime state.
 *
 * Default: continue the most recent session for the target dir, else create new.
 * Flags: --new (always fresh), --fork (copy current history into target).
 */

import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CD_USAGE, parseCdArgs, pathsEqual, resolveTargetPath } from "./cd-helpers.mjs";

const SESSION_VERSION = 3;

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "error" | "warning" = "info") {
	ctx.ui.notify(message, level);
}

/**
 * Ensure a SessionManager's JSONL exists on disk.
 * SessionManager.newSession() often defers the first write until an assistant message.
 */
function ensureSessionFileOnDisk(sm: SessionManager, parentSession?: string): string {
	const sessionFile = sm.getSessionFile();
	if (!sessionFile) {
		throw new Error("Target session is not persisted (in-memory only)");
	}
	if (existsSync(sessionFile)) {
		return sessionFile;
	}
	const dir = sm.getSessionDir() || dirname(sessionFile);
	if (dir && !existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const header = {
		type: "session",
		version: SESSION_VERSION,
		id: sm.getSessionId(),
		timestamp: new Date().toISOString(),
		cwd: sm.getCwd(),
		...(parentSession ? { parentSession } : {}),
	};
	writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { flag: "wx" });
	return sessionFile;
}

function resolveExistingDirectory(pathArg: string, baseCwd: string): string {
	const resolved = resolveTargetPath(pathArg, baseCwd);
	if (!existsSync(resolved)) {
		throw new Error(`No such directory: ${resolved}`);
	}
	const st = statSync(resolved);
	if (!st.isDirectory()) {
		throw new Error(`Not a directory: ${resolved}`);
	}
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function prepareSessionPath(
	mode: "continue" | "new" | "fork",
	targetCwd: string,
	currentSessionFile: string | undefined,
): { sessionPath: string; action: string } {
	if (mode === "fork") {
		if (!currentSessionFile || !existsSync(currentSessionFile)) {
			throw new Error("--fork requires a persisted current session file");
		}
		const forked = SessionManager.forkFrom(currentSessionFile, targetCwd);
		const path = forked.getSessionFile();
		if (!path || !existsSync(path)) {
			throw new Error("forkFrom did not produce a session file");
		}
		return { sessionPath: path, action: "forked history into" };
	}

	if (mode === "new") {
		const sm = SessionManager.create(targetCwd, undefined, {
			parentSession: currentSessionFile,
		});
		const path = ensureSessionFileOnDisk(sm, currentSessionFile);
		return { sessionPath: path, action: "new session in" };
	}

	// continue (default)
	const sm = SessionManager.continueRecent(targetCwd);
	const existing = sm.getSessionFile();
	if (existing && existsSync(existing)) {
		return { sessionPath: existing, action: "resumed session in" };
	}
	// continueRecent allocated a new session but may not have written the JSONL yet.
	// Re-create with parentSession so provenance is correct, then force-write the header.
	const created = SessionManager.create(targetCwd, undefined, {
		parentSession: currentSessionFile,
	});
	const path = ensureSessionFileOnDisk(created, currentSessionFile);
	return { sessionPath: path, action: "new session in" };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("pwd", {
		description: "Print current working directory and session file",
		handler: async (_args, ctx) => {
			const sessionFile = ctx.sessionManager.getSessionFile();
			const lines = [`cwd: ${ctx.cwd}`, `session: ${sessionFile ?? "(in-memory)"}`];
			notify(ctx, lines.join("\n"), "info");
		},
	});

	pi.registerCommand("cd", {
		description: "Change working directory (resume or create session for that project)",
		handler: async (args, ctx) => {
			const parsed = parseCdArgs(args ?? "");
			if (parsed.errors.length > 0) {
				notify(ctx, parsed.errors.join("\n"), "error");
				return;
			}

			if (!parsed.pathArg) {
				notify(ctx, `cwd: ${ctx.cwd}\n\n${CD_USAGE}`, "info");
				return;
			}

			let targetCwd: string;
			try {
				targetCwd = resolveExistingDirectory(parsed.pathArg, ctx.cwd);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
				return;
			}

			let currentReal = ctx.cwd;
			try {
				if (existsSync(ctx.cwd)) currentReal = realpathSync(ctx.cwd);
			} catch {
				// keep ctx.cwd
			}
			if (pathsEqual(currentReal, targetCwd)) {
				notify(ctx, `Already in ${targetCwd}`, "info");
				return;
			}

			try {
				await ctx.waitForIdle();
			} catch {
				// waitForIdle may not exist in all hosts; continue
			}

			const currentSessionFile = ctx.sessionManager.getSessionFile();

			let sessionPath: string;
			let action: string;
			try {
				({ sessionPath, action } = prepareSessionPath(parsed.mode, targetCwd, currentSessionFile));
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
				return;
			}

			try {
				const result = await ctx.switchSession(sessionPath, {
					withSession: async (replacementCtx) => {
						replacementCtx.ui.notify(`${action} ${targetCwd}`, "info");
					},
				});
				if (result.cancelled) {
					// Original ctx may still be valid if switch was cancelled before teardown.
					notify(ctx, "Directory change cancelled", "warning");
				}
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
