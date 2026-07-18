import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
	classifyBash,
	classifyFileTool,
	formatRisk,
	safetyPrompt,
	userExplicitlyRequestedRisk,
	type Risk,
} from "./safety-guard-helpers.ts";

type SafetyConfig = {
	enabled: boolean;
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "safety-guard.json");

const DEFAULT_CONFIG: SafetyConfig = { enabled: true };

function loadConfig(): SafetyConfig {
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<SafetyConfig>;
		return { ...DEFAULT_CONFIG, ...parsed };
	} catch {
		return DEFAULT_CONFIG;
	}
}

function saveConfig(config: SafetyConfig) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function lastUserText(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as any;
		const message = entry.type === "message" ? entry.message : undefined;
		if (message?.role !== "user") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
				.join("\n")
				.trim();
		}
	}
	return "";
}

async function isInsideGitRepo(pi: ExtensionAPI): Promise<boolean> {
	try {
		const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
		return result.code === 0 && result.stdout.trim() === "true";
	} catch {
		return false;
	}
}

async function shouldAllowRisk(risk: Risk, ctx: ExtensionContext): Promise<boolean> {
	if (!ctx.hasUI) return false;

	const choice = await ctx.ui.select(`${formatRisk(risk)}\n\nAllow this action?`, [
		"Allow once",
		"Block",
	]);

	return choice === "Allow once";
}

export default function safetyGuard(pi: ExtensionAPI) {
	let config = loadConfig();
	let gitRepoCache: boolean | undefined;

	function setEnabled(enabled: boolean) {
		config = { ...config, enabled };
		saveConfig(config);
	}

	async function getInsideGitRepo(piApi: ExtensionAPI): Promise<boolean> {
		if (gitRepoCache !== undefined) return gitRepoCache;
		gitRepoCache = await isInsideGitRepo(piApi);
		return gitRepoCache;
	}

	pi.registerCommand("safety", {
		description: "Manage Safety Guard: /safety enable|disable|status",
		handler: async (args, ctx) => {
			const subcommand = args.trim().toLowerCase();
			if (subcommand === "enable") {
				setEnabled(true);
				ctx.ui.setStatus("safety", "safety: on");
				ctx.ui.notify("Safety Guard enabled", "info");
				return;
			}
			if (subcommand === "disable") {
				setEnabled(false);
				ctx.ui.setStatus("safety", "safety: off");
				ctx.ui.notify("Safety Guard disabled", "warning");
				return;
			}
			if (subcommand === "status" || subcommand === "") {
				ctx.ui.notify(`Safety Guard is ${config.enabled ? "enabled" : "disabled"}`, config.enabled ? "info" : "warning");
				return;
			}
			ctx.ui.notify("Usage: /safety enable | /safety disable | /safety status", "warning");
		},
	});

	pi.registerCommand("permissions", {
		description: "Alias for Safety Guard: /permissions enable|disable|status",
		handler: async (args, ctx) => {
			const subcommand = args.trim().toLowerCase();
			if (subcommand === "enable") {
				setEnabled(true);
				ctx.ui.setStatus("safety", "safety: on");
				ctx.ui.notify("Safety Guard enabled", "info");
				return;
			}
			if (subcommand === "disable") {
				setEnabled(false);
				ctx.ui.setStatus("safety", "safety: off");
				ctx.ui.notify("Safety Guard disabled", "warning");
				return;
			}
			if (subcommand === "status" || subcommand === "") {
				ctx.ui.notify(`Safety Guard is ${config.enabled ? "enabled" : "disabled"}`, config.enabled ? "info" : "warning");
				return;
			}
			ctx.ui.notify("Usage: /permissions enable | /permissions disable | /permissions status", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		gitRepoCache = undefined;
		if (ctx.hasUI) ctx.ui.setStatus("safety", `safety: ${config.enabled ? "on" : "off"}`);
	});

	pi.on("before_agent_start", async (event) => {
		if (!config.enabled) return undefined;
		return { systemPrompt: event.systemPrompt + safetyPrompt() };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!config.enabled) return undefined;

		let risk: Risk | undefined;
		if (event.toolName === "bash") {
			const command = (event.input as Record<string, unknown>).command;
			if (typeof command === "string") risk = classifyBash(command);
		} else if (event.toolName === "write" || event.toolName === "edit") {
			const inGitRepo = await getInsideGitRepo(pi);
			risk = classifyFileTool(event.toolName, event.input as Record<string, unknown>, inGitRepo);
		} else if (event.toolName === "ctx_purge") {
			risk = {
				action: "Purge context-mode knowledge base",
				reason: "Purging permanently deletes indexed context and session-memory data.",
				severity: "destructive",
			};
		}

		if (!risk) return undefined;

		if (userExplicitlyRequestedRisk(lastUserText(ctx), risk)) {
			return undefined;
		}

		const allowed = await shouldAllowRisk(risk, ctx);
		if (!allowed) {
			return { block: true, reason: `Safety Guard blocked action.\n${formatRisk(risk)}` };
		}

		return undefined;
	});
}
