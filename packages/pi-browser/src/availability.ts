import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "./allowlist.ts";

export const AVAILABILITY_FILENAME = "pi-browser.json";

export type ToolAvailability = {
	available: boolean;
};

export function defaultToolAvailability(): ToolAvailability {
	return { available: true };
}

export function getAvailabilityPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	return join(getAgentDir(env, home), "extensions", AVAILABILITY_FILENAME);
}

export function parseToolAvailability(raw: unknown): ToolAvailability {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return defaultToolAvailability();
	}
	const src = raw as Record<string, unknown>;
	if (typeof src.available !== "boolean") return defaultToolAvailability();
	return { available: src.available };
}

export function loadToolAvailability(path: string = getAvailabilityPath()): ToolAvailability {
	try {
		return parseToolAvailability(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return defaultToolAvailability();
	}
}

export function saveToolAvailability(
	config: ToolAvailability,
	path: string = getAvailabilityPath(),
): boolean {
	const clean = parseToolAvailability(config);
	const body = `${JSON.stringify({ available: clean.available }, null, "\t")}\n`;
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(tmp, body, "utf8");
		renameSync(tmp, path);
		return true;
	} catch {
		try {
			unlinkSync(tmp);
		} catch {
		}
		return false;
	}
}

export function applyToolAvailability(
	pi: {
		getActiveTools: () => string[];
		setActiveTools: (names: string[]) => void;
	},
	available: boolean,
	toolNames: readonly string[],
): void {
	const active = pi.getActiveTools();
	const next = available
		? [...new Set([...active, ...toolNames])]
		: active.filter((name) => !toolNames.includes(name));
	if (next.length === active.length && next.every((name, i) => name === active[i])) return;
	pi.setActiveTools(next);
}
