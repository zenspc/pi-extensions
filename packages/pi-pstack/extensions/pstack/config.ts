import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const ROLE_NAMES = [
	"feature, refactoring",
	"bug-fix",
	"perf-issue",
	"hillclimb",
	"judgment and prose",
	"hardest tasks",
	"how explorer",
	"how explainer",
	"how critics",
	"why investigators",
	"why synthesizer",
	"reflect tooling",
	"reflect judgment, divergent, synthesizer",
	"arena runners",
	"arena cross-judge pool",
	"swarm workers",
	"architect runners",
	"interrogate reviewers",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];
export type RoleValue = string | string[];
export interface PstackConfig {
	version: 1;
	roles: Record<string, RoleValue>;
	skillsEnabled: boolean;
}

export const LIST_ROLES: ReadonlySet<RoleName> = new Set([
	"how critics",
	"arena runners",
	"arena cross-judge pool",
	"architect runners",
	"interrogate reviewers",
]);

const ROLE_NAME_SET: ReadonlySet<string> = new Set(ROLE_NAMES);
const DANGEROUS_KEY_PARTS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_CONFIG_BYTES = 100_000;
const MAX_MODEL_KEY_LENGTH = 256;
const INHERIT_SELECTORS = new Set(["inherit-parent", "auto"]);

export function getAgentDir(env: NodeJS.ProcessEnv = process.env, home: () => string = homedir): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${home()}$1`)
		: join(home(), ".pi", "agent");
}

export function configPath(env: NodeJS.ProcessEnv = process.env, home: () => string = homedir): string {
	return join(getAgentDir(env, home), "pstack", "models.json");
}

export function legacyMarkdownPath(env: NodeJS.ProcessEnv = process.env, home: () => string = homedir): string {
	return join(getAgentDir(env, home), "pstack-models.md");
}

export function defaultConfig(): PstackConfig {
	const roles: Record<string, RoleValue> = Object.create(null);
	for (const role of ROLE_NAMES) {
		roles[role] = "inherit-parent";
	}
	return { version: 1, roles, skillsEnabled: true };
}

export function isSafeModelSelector(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (INHERIT_SELECTORS.has(value)) return true;
	if (!value || value.length > MAX_MODEL_KEY_LENGTH) return false;
	if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;

	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return false;

	const provider = value.slice(0, slash);
	const id = value.slice(slash + 1);
	if (!provider || !id) return false;

	for (const part of value.split("/")) {
		if (!part || DANGEROUS_KEY_PARTS.has(part)) return false;
	}
	return true;
}

function parseRoleValue(value: unknown): RoleValue | undefined {
	if (typeof value === "string") {
		return isSafeModelSelector(value) ? value : undefined;
	}
	if (!Array.isArray(value)) return undefined;
	const selectors = value.filter(isSafeModelSelector);
	if (selectors.length === 0) return undefined;
	return selectors;
}

export function parseConfig(raw: unknown): PstackConfig {
	const fallback = defaultConfig();
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

	const record = raw as { version?: unknown; roles?: unknown };
	if (record.version !== 1 || !record.roles || typeof record.roles !== "object" || Array.isArray(record.roles)) {
		return fallback;
	}

	const roles: Record<string, RoleValue> = Object.create(null);
	for (const role of ROLE_NAMES) {
		roles[role] = fallback.roles[role];
	}
	for (const [key, value] of Object.entries(record.roles as Record<string, unknown>)) {
		if (!ROLE_NAME_SET.has(key)) continue;
		const parsed = parseRoleValue(value);
		if (parsed === undefined) continue;
		roles[key] = parsed;
	}
	const storedSkillsEnabled = (raw as { skillsEnabled?: unknown }).skillsEnabled;
	return {
		version: 1,
		roles,
		skillsEnabled:
			storedSkillsEnabled === true || storedSkillsEnabled === false
				? storedSkillsEnabled
				: fallback.skillsEnabled,
	};
}

export function loadConfig(path: string = configPath()): PstackConfig {
	try {
		if (!existsSync(path)) return defaultConfig();
		const st = lstatSync(path);
		if (!st.isFile()) return defaultConfig();
		if (st.size > MAX_CONFIG_BYTES) return defaultConfig();
		const text = readFileSync(path, "utf8");
		if (text.length > MAX_CONFIG_BYTES) return defaultConfig();
		return parseConfig(JSON.parse(text));
	} catch {
		return defaultConfig();
	}
}

export function saveConfig(config: PstackConfig, path: string = configPath()): boolean {
	const clean = parseConfig(config);
	const body = `${JSON.stringify({ version: 1, roles: clean.roles, skillsEnabled: clean.skillsEnabled }, null, 2)}\n`;
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (existsSync(path)) {
			const st = lstatSync(path);
			if (!st.isFile()) return false;
		}
		writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, path);
		return true;
	} catch {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			// best-effort temp cleanup
		}
		return false;
	}
}

export function parseLegacyMarkdown(text: string): PstackConfig {
	const roles: Record<string, RoleValue> = Object.create(null);
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon <= 0) continue;
		const name = trimmed.slice(0, colon).trim();
		if (!ROLE_NAME_SET.has(name)) continue;
		const parts = trimmed
			.slice(colon + 1)
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const parsed = parseRoleValue(parts.length <= 1 ? (parts[0] ?? "") : parts);
		if (parsed === undefined) continue;
		roles[name] = parsed;
	}
	return parseConfig({ version: 1, roles });
}

function isRegularFile(path: string): boolean {
	try {
		return existsSync(path) && lstatSync(path).isFile();
	} catch {
		return false;
	}
}

export function migrateLegacyMarkdownIfNeeded(
	jsonPath: string = configPath(),
	markdownPath: string = legacyMarkdownPath(),
): PstackConfig | undefined {
	if (existsSync(jsonPath)) return undefined;
	if (!isRegularFile(markdownPath)) return undefined;
	try {
		const migrated = parseLegacyMarkdown(readFileSync(markdownPath, "utf8"));
		if (!saveConfig(migrated, jsonPath)) return undefined;
		return migrated;
	} catch {
		return undefined;
	}
}

export function modelsForRole(config: PstackConfig, role: string): string[] {
	const value = config.roles[role];
	const list = Array.isArray(value) ? value : value ? [value] : [];
	return list.filter((selector) => !INHERIT_SELECTORS.has(selector));
}

export function formatRoleTable(config: PstackConfig): string {
	const lines: string[] = [];
	for (const role of ROLE_NAMES) {
		const models = modelsForRole(config, role);
		if (models.length === 0) continue;
		lines.push(`${role}: ${models.join(", ")}`);
	}
	return lines.join("\n");
}
