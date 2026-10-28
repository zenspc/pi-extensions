import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";

const DEFAULT_WAIT_MS = 30_000;
const POLL_MS = 100;

export type LaunchSpec = {
	chromeBin: string;
	userDataDir: string;
	extraArgs?: readonly string[];
};

export type SpawnChrome = (
	chromeBin: string,
	args: string[],
	options: SpawnOptions
) => ChildProcess;

export class MissingDebugPortError extends Error {
	constructor(userDataDir: string, cause?: unknown) {
		super(`No Debug Port found in the User Data Dir at ${userDataDir}.`);
		this.name = "MissingDebugPortError";
		this.cause = cause;
	}
}

export function chromeLaunchArgs(userDataDir: string, extraArgs: readonly string[] = []): string[] {
	return [
		`--user-data-dir=${userDataDir}`,
		"--remote-debugging-port=0",
		"--remote-debugging-address=127.0.0.1",
		"--no-first-run",
		"--no-default-browser-check",
		...extraArgs,
	];
}

export function parseDevToolsActivePort(contents: string): number {
	const firstLine = contents.split(/\r?\n/, 1)[0]?.trim() ?? "";
	const port = Number(firstLine);
	if (!/^\d+$/.test(firstLine) || !Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`Invalid DevToolsActivePort contents: ${JSON.stringify(firstLine)}`);
	}
	return port;
}

export function readDebugPort(
	userDataDir: string,
	readFile: (path: string) => string = (path) => readFileSync(path, "utf8")
): number {
	return parseDevToolsActivePort(readFile(join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE)));
}

export type ProbeDebugPort = (port: number, browserPath?: string) => Promise<void>;

async function defaultProbe(port: number, browserPath?: string): Promise<void> {
	const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
		signal: AbortSignal.timeout(2000),
		redirect: "error",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const version = (await response.json()) as { webSocketDebuggerUrl?: unknown };
	if (typeof version.webSocketDebuggerUrl !== "string")
		throw new Error("Chrome did not report a browser WebSocket");
	const endpoint = new URL(version.webSocketDebuggerUrl);
	if (
		endpoint.protocol !== "ws:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
		Number(endpoint.port) !== port ||
		endpoint.pathname !== browserPath
	) {
		throw new Error("Debug Port no longer belongs to this User Data Dir");
	}
}

export async function waitForDebugPort(
	userDataDir: string,
	options?: {
		timeoutMs?: number;
		readFile?: (path: string) => string;
		probe?: ProbeDebugPort;
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
	}
): Promise<number> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_MS;
	const probe = options?.probe ?? defaultProbe;
	const now = options?.now ?? Date.now;
	const sleep =
		options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
	const deadline = now() + timeoutMs;
	let lastError: unknown;

	while (now() < deadline) {
		try {
			const contents = (options?.readFile ?? ((path: string) => readFileSync(path, "utf8")))(
				join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE)
			);
			const port = parseDevToolsActivePort(contents);
			const browserPath = contents.split(/\r?\n/)[1]?.trim();
			await probe(port, browserPath);
			return port;
		} catch (error) {
			lastError = error;
			await sleep(POLL_MS);
		}
	}

	throw new MissingDebugPortError(userDataDir, lastError);
}

export function launchDedicatedChrome(
	spec: LaunchSpec,
	spawnChrome: SpawnChrome = spawn
): ChildProcess {
	const child = spawnChrome(spec.chromeBin, chromeLaunchArgs(spec.userDataDir, spec.extraArgs), {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	return child;
}
