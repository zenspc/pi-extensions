import { readlinkSync, unlinkSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { DEVTOOLS_ACTIVE_PORT_FILE } from "./launch.ts";

export const SINGLETON_LOCK_FILE = "SingletonLock";
export const SINGLETON_SOCKET_FILE = "SingletonSocket";
export const SINGLETON_COOKIE_FILE = "SingletonCookie";

export type ChromeLock =
	| { kind: "absent" }
	| { kind: "stale"; pid: number }
	| { kind: "live"; pid?: number };

export type DirOccupancy =
	| { kind: "empty" }
	| { kind: "stale-lock" }
	| { kind: "live-with-debug"; port: number }
	| { kind: "live-without-debug" };

export type OccupancyIo = {
	readlink?: (path: string) => string;
	processExists?: (pid: number) => boolean;
	hostname?: () => string;
};

export class LiveChromeWithoutDebugError extends Error {
	constructor(userDataDir: string) {
		super(
			`The dedicated Chrome at ${userDataDir} is already running without a Debug Port. Quit that window and try again.`,
		);
		this.name = "LiveChromeWithoutDebugError";
	}
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = error.code;
	return typeof code === "string" ? code : undefined;
}

export function parseLockTarget(target: string): { hostname: string; pid: number } | undefined {
	const trimmed = target.trim();
	const dash = trimmed.lastIndexOf("-");
	if (dash <= 0 || dash === trimmed.length - 1) return undefined;
	const hostname = trimmed.slice(0, dash);
	const pid = Number(trimmed.slice(dash + 1));
	if (!hostname || !Number.isInteger(pid) || pid <= 0) return undefined;
	return { hostname, pid };
}

function defaultProcessExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) !== "ESRCH";
	}
}

export function readChromeLock(userDataDir: string, io: OccupancyIo = {}): ChromeLock {
	const readlink = io.readlink ?? ((path) => readlinkSync(path, "utf8"));
	const processExists = io.processExists ?? defaultProcessExists;
	const hostname = io.hostname ?? osHostname;
	let target: string;
	try {
		target = readlink(join(userDataDir, SINGLETON_LOCK_FILE));
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { kind: "absent" };
		return { kind: "live" };
	}
	const parsed = parseLockTarget(target);
	if (!parsed) return { kind: "live" };
	if (parsed.hostname !== hostname()) return { kind: "live" };
	if (!processExists(parsed.pid)) return { kind: "stale", pid: parsed.pid };
	return { kind: "live", pid: parsed.pid };
}

export async function inspectOccupancy(
	userDataDir: string,
	options: OccupancyIo & { waitForPort: (userDataDir: string) => Promise<number> },
): Promise<DirOccupancy> {
	const lock = readChromeLock(userDataDir, options);
	switch (lock.kind) {
		case "absent":
			return { kind: "empty" };
		case "stale":
			return { kind: "stale-lock" };
		case "live": {
			try {
				const port = await options.waitForPort(userDataDir);
				return { kind: "live-with-debug", port };
			} catch {
				return { kind: "live-without-debug" };
			}
		}
		default: {
			const _exhaustive: never = lock;
			throw new Error(`unreachable lock ${String(_exhaustive)}`);
		}
	}
}

function defaultUnlink(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

export function clearStaleLock(
	userDataDir: string,
	unlink: (path: string) => void = defaultUnlink,
): void {
	for (const name of [
		SINGLETON_LOCK_FILE,
		SINGLETON_SOCKET_FILE,
		SINGLETON_COOKIE_FILE,
		DEVTOOLS_ACTIVE_PORT_FILE,
	]) {
		unlink(join(userDataDir, name));
	}
}
