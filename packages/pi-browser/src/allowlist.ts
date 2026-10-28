import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./storage.ts";

export const ALLOWLIST_FILENAME = "pi-browser-allowlist.json";

export interface AllowlistFile {
	version: 1;
	domains: string[];
}

export function getAgentDir(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir
): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir ? envDir.replace(/^~(\/|$)/, `${home()}$1`) : join(home(), ".pi", "agent");
}

export function getAllowlistPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir
): string {
	return join(getAgentDir(env, home), "extensions", ALLOWLIST_FILENAME);
}

export function parseAllowlist(raw: unknown): Set<string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
	const file = raw as Record<string, unknown>;
	if (file.version !== 1) return new Set();
	const domains = file.domains;
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
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, domains: [] };
		throw new Error(
			`Cannot update invalid Allowlist at ${path}. Repair it before approving permanently.`,
			{ cause: error }
		);
	}
	const file = raw as AllowlistFile | null;
	if (
		!file ||
		file.version !== 1 ||
		!Array.isArray(file.domains) ||
		!file.domains.every((entry) => typeof entry === "string")
	) {
		throw new Error(
			`Cannot update invalid Allowlist at ${path}. Repair it before approving permanently.`
		);
	}
	return { version: 1, domains: [...new Set(file.domains)].sort() };
}

export function addToAllowlist(domain: string, path: string = getAllowlistPath()): void {
	const file = readAllowlistFile(path);
	if (!file.domains.includes(domain)) file.domains.push(domain);
	file.domains.sort();
	writeJsonAtomic(path, file);
}
