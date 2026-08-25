import {
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const ALLOWLIST_FILENAME = "pi-browser-allowlist.json";

export interface AllowlistFile {
	version: 1;
	domains: string[];
}

export function getAgentDir(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${home()}$1`)
		: join(home(), ".pi", "agent");
}

export function getAllowlistPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	return join(getAgentDir(env, home), "extensions", ALLOWLIST_FILENAME);
}

export function parseAllowlist(raw: unknown): Set<string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
	const domains = (raw as Record<string, unknown>).domains;
	if (!Array.isArray(domains)) return new Set();
	return new Set(domains.filter((entry): entry is string => typeof entry === "string"));
}

export function loadAllowlist(path: string = getAllowlistPath()): Set<string> {
	try {
		return parseAllowlist(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return new Set();
	}
}

function readAllowlistFile(path: string): AllowlistFile {
	return { version: 1, domains: [...loadAllowlist(path)].sort() };
}

export function addToAllowlist(domain: string, path: string = getAllowlistPath()): void {
	const file = readAllowlistFile(path);
	if (!file.domains.includes(domain)) file.domains.push(domain);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
		renameSync(tmp, path);
	} catch (error) {
		try {
			unlinkSync(tmp);
		} catch {
		}
		throw error;
	}
}
