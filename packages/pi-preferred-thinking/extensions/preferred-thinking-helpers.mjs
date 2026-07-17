import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
]);

export const CONFIG_FILENAME = "preferred-thinking.json";

/** Cap untrusted config file size (DoS / parse cost). */
export const MAX_CONFIG_BYTES = 100_000;

/** Cap number of model → level mappings kept after parse. */
export const MAX_CONFIG_ENTRIES = 500;

/** Cap length of a single provider/id key. */
export const MAX_MODEL_KEY_LENGTH = 256;

const VALID_LEVEL_SET = new Set(VALID_THINKING_LEVELS);
const DANGEROUS_KEY_PARTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Same base dir as pi's agent config (including PI_CODING_AGENT_DIR).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {() => string} [home]
 */
export function getAgentDir(env = process.env, home = homedir) {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${home()}$1`)
		: join(home(), ".pi", "agent");
}

/**
 * Config lives under the agent extensions directory.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {() => string} [home]
 */
export function getConfigPath(env = process.env, home = homedir) {
	return join(getAgentDir(env, home), "extensions", CONFIG_FILENAME);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidThinkingLevel(value) {
	return typeof value === "string" && VALID_LEVEL_SET.has(value);
}

/**
 * @param {string} provider
 * @param {string} id
 */
export function modelKey(provider, id) {
	return `${provider}/${id}`;
}

/**
 * Reject prototype-pollution vectors and oversized/malformed keys.
 * Shape: non-empty provider + "/" + non-empty id (id may contain further "/").
 * @param {string} key
 */
export function isSafeModelKey(key) {
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
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function parsePreferredThinkingConfig(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return Object.create(null);
	}

	/** @type {Record<string, string>} */
	const out = Object.create(null);
	let count = 0;
	for (const [key, value] of Object.entries(raw)) {
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

/**
 * @param {Record<string, string> | null | undefined} map
 * @param {string} provider
 * @param {string} id
 * @returns {string | undefined}
 */
export function resolvePreferredLevel(map, provider, id) {
	if (!map || typeof map !== "object") return undefined;
	const key = modelKey(provider, id);
	if (!isSafeModelKey(key)) return undefined;
	if (!Object.hasOwn(map, key)) return undefined;
	const level = map[key];
	return isValidThinkingLevel(level) ? level : undefined;
}

/**
 * Detect CLI thinking overrides that should win over preferred defaults at startup.
 * @param {string[]} [argv]
 */
export function hasCliThinkingOverride(argv = process.argv) {
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

/**
 * @param {string} reason
 * @param {string[]} [argv]
 */
export function shouldApplyOnSessionStart(reason, argv = process.argv) {
	if (reason !== "startup" && reason !== "new") return false;
	return !hasCliThinkingOverride(argv);
}

/**
 * @param {string} source
 */
export function shouldApplyOnModelSelect(source) {
	return source === "set" || source === "cycle";
}

/**
 * Load preferences from disk. Missing/invalid/oversized files yield {}.
 * @param {string} [path]
 * @returns {Record<string, string>}
 */
export function loadPreferredThinkingConfig(path = getConfigPath()) {
	try {
		if (!existsSync(path)) return Object.create(null);
		const st = statSync(path);
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
 * @param {Record<string, string>} map
 * @param {string} [path]
 */
export function savePreferredThinkingConfig(map, path = getConfigPath()) {
	const clean = parsePreferredThinkingConfig(map);
	// JSON.stringify on null-prototype objects still works; sort keys for stable diffs.
	const ordered = Object.fromEntries(Object.keys(clean).sort().map((k) => [k, clean[k]]));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}
