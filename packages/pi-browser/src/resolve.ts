import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export const USER_DATA_DIR_ENV = "PI_BROWSER_USER_DATA_DIR";
export const CHROME_BIN_ENV = "PI_BROWSER_CHROME_BIN";

const DEFAULT_USER_DATA_DIR_NAME = ".pi-chrome";

export type ResolveHost = {
	env?: NodeJS.ProcessEnv;
	homedir?: string;
	platform?: NodeJS.Platform;
	exists?: (path: string) => boolean;
};

type OsFamily = "linux" | "darwin" | "win32";

type BinaryCandidate = { kind: "name"; name: string } | { kind: "path"; path: string };

type ResolvedHost = {
	env: NodeJS.ProcessEnv;
	homedir: string;
	family: OsFamily;
	exists: (path: string) => boolean;
};

export class RelativeUserDataDirError extends Error {
	constructor(value: string) {
		super(
			`${USER_DATA_DIR_ENV} must be an absolute path after ~ expansion (got ${value})`,
		);
		this.name = "RelativeUserDataDirError";
	}
}

export class MissingChromeBinaryError extends Error {
	constructor(overrideValue?: string) {
		super(
			overrideValue
				? `${CHROME_BIN_ENV}=${overrideValue} does not exist. Set ${CHROME_BIN_ENV} to a Chrome, Chromium, or Edge executable.`
				: `No Chrome binary found. Set ${CHROME_BIN_ENV} to a Chrome, Chromium, or Edge executable.`,
		);
		this.name = "MissingChromeBinaryError";
	}
}

const LINUX_CANDIDATES: readonly BinaryCandidate[] = [
	{ kind: "path", path: "/usr/bin/google-chrome-stable" },
	{ kind: "path", path: "/usr/bin/google-chrome" },
	{ kind: "path", path: "/usr/bin/chromium-browser" },
	{ kind: "path", path: "/usr/bin/chromium" },
	{ kind: "path", path: "/snap/bin/chromium" },
	{ kind: "path", path: "/usr/bin/microsoft-edge-stable" },
	{ kind: "path", path: "/usr/bin/microsoft-edge" },
	{ kind: "name", name: "google-chrome-stable" },
	{ kind: "name", name: "google-chrome" },
	{ kind: "name", name: "chromium-browser" },
	{ kind: "name", name: "chromium" },
	{ kind: "name", name: "microsoft-edge-stable" },
	{ kind: "name", name: "microsoft-edge" },
];

const DARWIN_CANDIDATES: readonly BinaryCandidate[] = [
	{ kind: "path", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
	{ kind: "path", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
	{ kind: "path", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
	{ kind: "name", name: "google-chrome" },
	{ kind: "name", name: "chromium" },
	{ kind: "name", name: "microsoft-edge" },
];

function osFamily(platform: NodeJS.Platform): OsFamily {
	if (platform === "darwin" || platform === "win32") return platform;
	return "linux";
}

function pathOps(family: OsFamily) {
	return family === "win32" ? win32 : posix;
}

function nonempty(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	return nonempty(env[name]);
}

function expandLeadingTilde(
	value: string,
	home: string,
	join: (...paths: string[]) => string,
): string {
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return join(home, value.slice(2));
	}
	return value;
}

function resolveHost(host: ResolveHost = {}): ResolvedHost {
	return {
		env: host.env ?? process.env,
		homedir: host.homedir ?? homedir(),
		family: osFamily(host.platform ?? process.platform),
		exists: host.exists ?? ((path) => existsSync(path)),
	};
}

function win32Candidates(
	env: NodeJS.ProcessEnv,
	join: (...paths: string[]) => string,
): BinaryCandidate[] {
	const pf = nonempty(env.PROGRAMFILES) ?? "C:\\Program Files";
	const pf86 = nonempty(env["PROGRAMFILES(X86)"]) ?? "C:\\Program Files (x86)";
	const local = nonempty(env.LOCALAPPDATA);
	const roots = local === undefined ? [pf, pf86] : [pf, pf86, local];
	const relatives = [
		["Google", "Chrome", "Application", "chrome.exe"],
		["Chromium", "Application", "chrome.exe"],
		["Microsoft", "Edge", "Application", "msedge.exe"],
	] as const;
	const paths: BinaryCandidate[] = [];
	for (const parts of relatives) {
		for (const root of roots) {
			paths.push({ kind: "path", path: join(root, ...parts) });
		}
	}
	return [
		...paths,
		{ kind: "name", name: "chrome.exe" },
		{ kind: "name", name: "chromium.exe" },
		{ kind: "name", name: "msedge.exe" },
	];
}

function candidatesFor(host: ResolvedHost): readonly BinaryCandidate[] {
	switch (host.family) {
		case "darwin":
			return DARWIN_CANDIDATES;
		case "win32":
			return win32Candidates(host.env, pathOps(host.family).join);
		case "linux":
			return LINUX_CANDIDATES;
		default: {
			const _exhaustive: never = host.family;
			return _exhaustive;
		}
	}
}

function lookupOnPath(name: string, host: ResolvedHost): string | undefined {
	const pathVar = nonempty(host.env.PATH) ?? nonempty(host.env.Path);
	if (pathVar === undefined) return undefined;
	const { join, delimiter } = pathOps(host.family);
	for (const dir of pathVar.split(delimiter)) {
		if (dir === "") continue;
		const candidate = join(dir, name);
		if (host.exists(candidate)) return candidate;
	}
	return undefined;
}

function locateCandidate(candidate: BinaryCandidate, host: ResolvedHost): string | undefined {
	switch (candidate.kind) {
		case "path":
			return host.exists(candidate.path) ? candidate.path : undefined;
		case "name":
			return lookupOnPath(candidate.name, host);
		default: {
			const _exhaustive: never = candidate;
			return _exhaustive;
		}
	}
}

function locateOverride(raw: string, host: ResolvedHost): string | undefined {
	const expanded = expandLeadingTilde(raw, host.homedir, pathOps(host.family).join);
	if (pathOps(host.family).isAbsolute(expanded)) {
		return host.exists(expanded) ? expanded : undefined;
	}
	const fromPath = lookupOnPath(expanded, host);
	if (fromPath !== undefined) return fromPath;
	return host.exists(expanded) ? expanded : undefined;
}

export function resolveUserDataDir(host: ResolveHost = {}): string {
	const resolved = resolveHost(host);
	const override = envValue(resolved.env, USER_DATA_DIR_ENV);
	const { join, isAbsolute } = pathOps(resolved.family);
	if (override === undefined) {
		return join(resolved.homedir, DEFAULT_USER_DATA_DIR_NAME);
	}
	const expanded = expandLeadingTilde(override, resolved.homedir, join);
	if (!isAbsolute(expanded)) {
		throw new RelativeUserDataDirError(override);
	}
	return expanded;
}

export function resolveChromeBinary(host: ResolveHost = {}): string {
	const resolved = resolveHost(host);
	const override = envValue(resolved.env, CHROME_BIN_ENV);
	if (override !== undefined) {
		const found = locateOverride(override, resolved);
		if (found === undefined) throw new MissingChromeBinaryError(override);
		return found;
	}
	for (const candidate of candidatesFor(resolved)) {
		const found = locateCandidate(candidate, resolved);
		if (found !== undefined) return found;
	}
	throw new MissingChromeBinaryError();
}
