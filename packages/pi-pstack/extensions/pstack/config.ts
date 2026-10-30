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

function isConfigRecord(raw: unknown): raw is { version: 1; roles: Record<string, unknown>; skillsEnabled?: unknown } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
	const record = raw as { version?: unknown; roles?: unknown };
	return record.version === 1 && !!record.roles && typeof record.roles === "object" && !Array.isArray(record.roles);
}

export function parseConfig(raw: unknown, diagnostics: string[] = []): PstackConfig {
	const fallback = defaultConfig();
	if (!isConfigRecord(raw)) {
		diagnostics.push("Expected version 1 and a roles object.");
		return fallback;
	}

	const roles: Record<string, RoleValue> = Object.create(null);
	for (const role of ROLE_NAMES) {
		roles[role] = fallback.roles[role];
	}
	for (const [key, value] of Object.entries(raw.roles)) {
		if (!ROLE_NAME_SET.has(key)) {
			diagnostics.push("roles: unknown role ignored.");
			continue;
		}
		const parsed = parseRoleValue(value);
		if (Array.isArray(value)) {
			value.forEach((selector, index) => {
				if (!isSafeModelSelector(selector)) diagnostics.push(`roles.${key}[${index}]: invalid model selector ignored.`);
			});
		}
		if (parsed === undefined) {
			diagnostics.push(`roles.${key}: invalid role value; using inherit-parent.`);
			continue;
		}
		roles[key] = parsed;
	}
	const storedSkillsEnabled = raw.skillsEnabled;
	if (storedSkillsEnabled !== undefined && typeof storedSkillsEnabled !== "boolean") {
		diagnostics.push("skillsEnabled: expected a boolean; using true.");
	}
	return {
		version: 1,
		roles,
		skillsEnabled:
			storedSkillsEnabled === true || storedSkillsEnabled === false
				? storedSkillsEnabled
				: fallback.skillsEnabled,
	};
}

export interface ConfigLoadResult {
	path: string;
	config: PstackConfig;
	status: "missing" | "loaded" | "partial" | "invalid";
	diagnostics: string[];
}

export function loadConfig(path: string = configPath()): ConfigLoadResult {
	const result: ConfigLoadResult = { path, config: defaultConfig(), status: "invalid", diagnostics: [] };
	let text: string;
	try {
		const st = lstatSync(path);
		if (!st.isFile()) {
			result.diagnostics.push("Expected a regular file, not a directory or symlink.");
			return result;
		}
		if (st.size > MAX_CONFIG_BYTES) {
			result.diagnostics.push(`Configuration exceeds ${MAX_CONFIG_BYTES} bytes.`);
			return result;
		}
		text = readFileSync(path, "utf8");
		if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
			result.diagnostics.push(`Configuration exceeds ${MAX_CONFIG_BYTES} bytes.`);
			return result;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") result.status = "missing";
		else result.diagnostics.push("Cannot read configuration.");
		return result;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		result.diagnostics.push("Invalid JSON.");
		return result;
	}
	result.config = parseConfig(raw, result.diagnostics);
	result.status = !isConfigRecord(raw) ? "invalid" : result.diagnostics.length ? "partial" : "loaded";
	return result;
}

export function saveConfig(config: PstackConfig, path: string = configPath()): boolean {
	const clean = parseConfig(config);
	const body = `${JSON.stringify({ version: 1, roles: clean.roles, skillsEnabled: clean.skillsEnabled }, null, 2)}\n`;
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const st = lstatSync(path, { throwIfNoEntry: false });
		if (st && !st.isFile()) return false;
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
	if (loadConfig(jsonPath).status !== "missing") return undefined;
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
	return Array.isArray(value) ? [...value] : value ? [value] : [];
}

export function formatRoleTable(config: PstackConfig): string {
	const lines: string[] = [];
	for (const role of ROLE_NAMES) {
		const models = modelsForRole(config, role);
		if (models.length === 0 || (typeof config.roles[role] === "string" && INHERIT_SELECTORS.has(models[0]))) continue;
		lines.push(`${role}: ${models.join(", ")}`);
	}
	return lines.join("\n");
}

export function formatPanelStatus(config: PstackConfig, parentModel?: string): string {
	return [...LIST_ROLES].map((role) => {
		let selectors = modelsForRole(config, role);
		if (!Array.isArray(config.roles[role]) && selectors.length === 1 && INHERIT_SELECTORS.has(selectors[0])) {
			selectors = [selectors[0], selectors[0]];
		}
		const effective = selectors.map((selector) => INHERIT_SELECTORS.has(selector) ? parentModel : selector);
		const labels = selectors.map((selector, index) => INHERIT_SELECTORS.has(selector)
			? `${effective[index] ?? "parent model unresolved"} (inherited)` : selector);
		const pool = role === "arena cross-judge pool";
		const diversity = effective.includes(undefined) ? "parent model unresolved"
			: new Set(effective).size > 1 ? "distinct selectors; family diversity not guaranteed"
			: `${effective.length === 1 ? "single" : "same"}-model ${pool ? "pool" : "panel"}`;
		return `${role}: ${labels.join(", ")} [${diversity}${pool ? "; choose one judge" : ""}]`;
	}).join("\n");
}
