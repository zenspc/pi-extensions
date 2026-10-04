import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

/** Valid Pi thinking levels. */
export const VALID_THINKING_LEVELS = Object.freeze([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const);

export type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

export type PreferredSubcommand = {
	name: string;
	description: string;
};

/** Subcommands for /preferred-thinking. */
export const SUBCOMMANDS: readonly PreferredSubcommand[] = Object.freeze([
	{ name: "show", description: "Show preference and live level for the current model" },
	{ name: "list", description: "List all stored model preferences" },
	{ name: "set", description: "Save and apply a thinking level for the current model" },
	{ name: "clear", description: "Remove the stored preference for the current model" },
	{ name: "reload", description: "Re-read preferences from disk" },
	{ name: "help", description: "Show available subcommands" },
]);

export type AutocompleteItem = {
	value: string;
	label: string;
};

export const CONFIG_FILENAME = "preferred-thinking.json";

/** Cap untrusted config file size (DoS / parse cost). */
export const MAX_CONFIG_BYTES = 100_000;

/** Cap number of model → level mappings kept after parse. */
export const MAX_CONFIG_ENTRIES = 500;

/** Cap length of a single provider/id key. */
export const MAX_MODEL_KEY_LENGTH = 256;

const VALID_LEVEL_SET: ReadonlySet<string> = new Set(VALID_THINKING_LEVELS);
const DANGEROUS_KEY_PARTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Same base dir as pi's agent config (including PI_CODING_AGENT_DIR).
 */
export function getAgentDir(env: NodeJS.ProcessEnv = process.env, home: () => string = homedir): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${home()}$1`)
		: join(home(), ".pi", "agent");
}

/**
 * Config lives under the agent extensions directory.
 */
export function getConfigPath(env: NodeJS.ProcessEnv = process.env, home: () => string = homedir): string {
	return join(getAgentDir(env, home), "extensions", CONFIG_FILENAME);
}

export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && VALID_LEVEL_SET.has(value);
}

export function modelKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

/**
 * Reject prototype-pollution vectors and oversized/malformed keys.
 * Shape: non-empty provider + "/" + non-empty id (id may contain further "/").
 */
export function isSafeModelKey(key: unknown): key is string {
	if (typeof key !== "string") return false;
	if (!key || key.length > MAX_MODEL_KEY_LENGTH) return false;
	// Reject control chars / path separators that do not belong in model ids.
	if (/[\u0000-\u001f\u007f\\]/.test(key)) return false;

	const slash = key.indexOf("/");
	if (slash <= 0 || slash === key.length - 1) return false;

	const provider = key.slice(0, slash);
	const id = key.slice(slash + 1);
	if (!provider || !id) return false;

	for (const part of key.split("/")) {
		if (!part || DANGEROUS_KEY_PARTS.has(part)) return false;
	}
	return true;
}

/**
 * Sanitize raw JSON into a provider/id → level map.
 * Invalid keys/values are dropped (ignored). Uses a null-prototype object.
 */
export function parsePreferredThinkingConfig(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return Object.create(null);
	}

	const out: Record<string, string> = Object.create(null);
	let count = 0;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (count >= MAX_CONFIG_ENTRIES) break;
		if (typeof key !== "string") continue;
		const trimmedKey = key.trim();
		if (!isSafeModelKey(trimmedKey)) continue;
		if (!isValidThinkingLevel(value)) continue;
		out[trimmedKey] = value;
		count += 1;
	}
	return out;
}

export function resolvePreferredLevel(
	map: Record<string, string> | null | undefined,
	provider: string,
	id: string,
): string | undefined {
	if (!map || typeof map !== "object") return undefined;
	const key = modelKey(provider, id);
	if (!isSafeModelKey(key)) return undefined;
	if (!Object.hasOwn(map, key)) return undefined;
	const level = map[key];
	return isValidThinkingLevel(level) ? level : undefined;
}

/**
 * Detect CLI thinking overrides that should win over preferred defaults at startup.
 */
export function hasCliThinkingOverride(argv: string[] = process.argv): boolean {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--thinking" || arg.startsWith("--thinking=")) {
			return true;
		}
		if (arg === "--model" || arg === "-m") {
			const value = argv[i + 1];
			if (typeof value === "string" && value.includes(":")) {
				return true;
			}
			continue;
		}
		if (arg.startsWith("--model=") && arg.includes(":")) {
			return true;
		}
	}
	return false;
}

export function shouldApplyOnSessionStart(reason: string, argv: string[] = process.argv): boolean {
	if (reason !== "startup" && reason !== "new") return false;
	return !hasCliThinkingOverride(argv);
}

export function shouldApplyOnModelSelect(source: string): boolean {
	return source === "set" || source === "cycle";
}

/**
 * Human-readable /preferred-thinking help, including subcommands and levels.
 */
export function formatPreferredThinkingHelp(configPath?: string): string {
	const lines = [
		"Usage: /preferred-thinking [show|list|set <level>|clear|reload|help]",
		"",
		"Subcommands:",
		...SUBCOMMANDS.map((cmd) => `  ${cmd.name.padEnd(8)} ${cmd.description}`),
		"",
		`Levels: ${VALID_THINKING_LEVELS.join(", ")}`,
	];
	if (configPath) {
		lines.push("", `Config: ${configPath}`);
	}
	return lines.join("\n");
}

/**
 * Argument auto-completion for /preferred-thinking.
 * Completes subcommands on the first token and thinking levels after `set`.
 */
export function getPreferredThinkingArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const raw = typeof argumentPrefix === "string" ? argumentPrefix : "";
	const hasTrailingSpace = /\s$/.test(raw);
	const parts = raw.trim().split(/\s+/).filter(Boolean);

	// `/preferred-thinking ` or partial first token → subcommands
	if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
		const prefix = (parts[0] ?? "").toLowerCase();
		const items = SUBCOMMANDS
			.filter((cmd) => cmd.name.startsWith(prefix))
			.map((cmd) => ({ value: cmd.name, label: `${cmd.name}  ${cmd.description}` }));
		return items.length > 0 ? items : null;
	}

	// `/preferred-thinking set ` or partial level → thinking levels.
	// Pi replaces the entire argument prefix with `value`, so keep `set` in value.
	const sub = parts[0]?.toLowerCase();
	if (sub === "set" && (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace))) {
		const prefix = (parts[1] ?? "").toLowerCase();
		const items = VALID_THINKING_LEVELS
			.filter((level) => level.startsWith(prefix))
			.map((level) => ({ value: `set ${level}`, label: level }));
		return items.length > 0 ? items : null;
	}

	return null;
}

/**
 * Load preferences from disk. Missing/invalid/oversized/non-regular files yield {}.
 * Uses lstat so symlinks are not followed (avoids symlink-based redirects).
 */
export function loadPreferredThinkingConfig(path: string = getConfigPath()): Record<string, string> {
	try {
		if (!existsSync(path)) return Object.create(null);
		// lstat: refuse symlinks, dirs, devices — only a regular file is trusted input.
		const st = lstatSync(path);
		if (!st.isFile()) return Object.create(null);
		if (st.size > MAX_CONFIG_BYTES) {
			console.error(
				`pi-preferred-thinking: ${CONFIG_FILENAME} is unexpectedly large (${st.size} bytes); ignoring`,
			);
			return Object.create(null);
		}
		const text = readFileSync(path, "utf8");
		if (text.length > MAX_CONFIG_BYTES) {
			console.error(`pi-preferred-thinking: ${CONFIG_FILENAME} exceeds size cap; ignoring`);
			return Object.create(null);
		}
		return parsePreferredThinkingConfig(JSON.parse(text));
	} catch {
		return Object.create(null);
	}
}

/**
 * Persist preferences map to disk (invalid entries stripped).
 * Writes atomically via temp file + rename, mode 0o600. Returns false on failure.
 */
export function savePreferredThinkingConfig(map: Record<string, string>, path: string = getConfigPath()): boolean {
	const clean = parsePreferredThinkingConfig(map);
	// JSON.stringify on null-prototype objects still works; sort keys for stable diffs.
	const ordered = Object.fromEntries(Object.keys(clean).sort().map((k) => [k, clean[k]]));
	const body = `${JSON.stringify(ordered, null, 2)}\n`;
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		// Refuse to clobber a non-regular path (symlink/dir/device) at the destination name.
		if (existsSync(path)) {
			const st = lstatSync(path);
			if (!st.isFile()) {
				console.error(`pi-preferred-thinking: refusing to overwrite non-regular path ${CONFIG_FILENAME}`);
				return false;
			}
		}
		writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, path);
		return true;
	} catch (err) {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			// best-effort temp cleanup
		}
		const message = err instanceof Error ? err.message : String(err);
		console.error(`pi-preferred-thinking: failed to save ${CONFIG_FILENAME}: ${message}`);
		return false;
	}
}
