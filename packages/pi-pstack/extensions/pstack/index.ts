import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	LIST_ROLES,
	ROLE_NAMES,
	type PstackConfig,
	type RoleName,
	type RoleValue,
	configPath,
	defaultConfig,
	formatRoleTable,
	isSafeModelSelector,
	loadConfig,
	migrateLegacyMarkdownIfNeeded,
	saveConfig,
} from "./config.ts";
import { stripSkillsByLocationPrefix } from "./skill-strip.ts";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

const POTETO_SKILL = "/skill:poteto-mode";
const POTETO_PROMPT =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

export function systemPromptInjection(config: PstackConfig, potetoMode: boolean): string {
	const parts: string[] = [];
	const table = formatRoleTable(config);
	if (table) parts.push(table);
	if (potetoMode) parts.push(POTETO_PROMPT);
	return parts.join("\n\n");
}

type ModeEntry = {
	type?: string;
	customType?: string;
	data?: { enabled?: unknown };
};

function sessionEntries(ctx: ExtensionContext): ModeEntry[] {
	const sm = ctx.sessionManager as {
		getBranch?: () => ModeEntry[];
		getEntries: () => ModeEntry[];
	};
	return typeof sm.getBranch === "function" ? sm.getBranch() : sm.getEntries();
}

function lastPotetoEnabled(entries: ModeEntry[]): boolean {
	let enabled = false;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "pstack-mode") {
			enabled = Boolean(entry.data?.enabled);
		}
	}
	return enabled;
}

function stripCurrentMark(choice: string): string {
	return choice.endsWith(" (current)") ? choice.slice(0, -" (current)".length) : choice;
}

function labeledChoices(choices: string[], current: RoleValue | undefined): string[] {
	const currents = new Set(Array.isArray(current) ? current : current ? [current] : []);
	return choices.map((choice) => (currents.has(choice) ? `${choice} (current)` : choice));
}

function modelChoices(ctx: ExtensionCommandContext): string[] {
	const models =
		ctx.scopedModels.length > 0
			? ctx.scopedModels.map((entry) => entry.model)
			: ctx.modelRegistry.getAvailable();
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const model of models) {
		const key = `${model.provider}/${model.id}`;
		if (!isSafeModelSelector(key) || seen.has(key)) continue;
		seen.add(key);
		ids.push(key);
	}
	return ["inherit-parent", "auto", ...ids];
}

function isInheritSelector(value: string): boolean {
	return value === "inherit-parent" || value === "auto";
}

export default function pstackExtension(pi: ExtensionAPI): void {
	let potetoMode = false;

	function setStatus(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setStatus("pstack-mode", potetoMode ? "pstack: poteto mode" : undefined);
	}

	function persistMode(enabled: boolean, ctx?: ExtensionContext): void {
		potetoMode = enabled;
		pi.appendEntry("pstack-mode", { enabled });
		if (ctx) setStatus(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		potetoMode = false;
		potetoMode = lastPotetoEnabled(sessionEntries(ctx));
		setStatus(ctx);
		try {
			migrateLegacyMarkdownIfNeeded();
		} catch {
			// ignore migration errors
		}
	});

	pi.on("input", async (event, ctx) => {
		if (/^\/skill:poteto-mode(?:\s|$)/.test(event.text)) {
			persistMode(true, ctx);
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event) => {
		const config = loadConfig();
		const base = config.skillsEnabled
			? event.systemPrompt
			: stripSkillsByLocationPrefix(event.systemPrompt, SKILLS_DIR).prompt;
		const extra = systemPromptInjection(config, potetoMode);
		return {
			systemPrompt: extra ? `${base}\n\n${extra}` : base,
		};
	});

	pi.registerCommand("poteto-mode", {
		description: "Enable or disable sticky pstack Poteto Mode. Usage: /poteto-mode [task] | /poteto-mode off",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			if (!token || "off".startsWith(token)) {
				return [{ value: "off", label: "off" }];
			}
			return null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const token = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
			if (token === "off" || token === "disable" || token === "stop") {
				persistMode(false, ctx);
				ctx.ui.notify("Poteto Mode off.", "info");
				return;
			}
			persistMode(true, ctx);
			ctx.ui.notify("Poteto Mode on. Stays on until /poteto-mode off.", "info");
			const payload = `${POTETO_SKILL}${raw ? ` ${raw}` : ""}`;
			pi.sendUserMessage(
				payload,
				ctx.isIdle()
					? { expandPromptTemplates: true }
					: { expandPromptTemplates: true, deliverAs: "followUp" },
			);
		},
	});

	pi.registerCommand("setup-pstack", {
		description: "Map pstack delegation roles to models available in this Pi session.",
		handler: async (_args, ctx) => {
			try {
				migrateLegacyMarkdownIfNeeded();
			} catch {
				// ignore
			}
			const path = configPath();
			const config = loadConfig();
			if (!ctx.hasUI) {
				if (!existsSync(path) && !saveConfig(defaultConfig(), path)) {
					ctx.ui.notify(`Failed to write ${path}`, "error");
					return;
				}
				ctx.ui.notify(`Wrote ${path}`, "info");
				return;
			}

			const choices = modelChoices(ctx);
			for (const role of ROLE_NAMES) {
				const next = LIST_ROLES.has(role)
					? await pickListRole(ctx, role, choices, config.roles[role])
					: await pickScalarRole(ctx, role, choices, config.roles[role]);
				if (next === undefined) break;
				config.roles[role] = next;
			}

			if (!saveConfig(config, path)) {
				ctx.ui.notify(`Failed to write ${path}`, "error");
				return;
			}
			ctx.ui.notify(`Wrote ${path}`, "info");
		},
	});

	pi.registerCommand("pstack", {
		description: "Show or toggle whether pstack skills are listed in the system prompt. Usage: /pstack [on|off|status]",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			const options = ["on", "off", "status"].filter((value) => value.startsWith(token));
			if (options.length === 0) return null;
			return options.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const token = args.trim().toLowerCase();
			const config = loadConfig();
			if (token === "" || token === "status") {
				const state = config.skillsEnabled ? "on" : "off";
				const hint = config.skillsEnabled ? "" : " Skills are hidden from the model; /skill:<name> still works.";
				ctx.ui.notify(`pstack is ${state}.${hint}`, "info");
				return;
			}
			const enabled = token === "on" || token === "enable";
			if (!enabled && token !== "off" && token !== "disable") {
				ctx.ui.notify("Usage: /pstack [on|off|status]", "error");
				return;
			}
			if (enabled !== config.skillsEnabled) {
				config.skillsEnabled = enabled;
				if (!saveConfig(config)) {
					ctx.ui.notify(`Failed to write ${configPath()}`, "error");
					return;
				}
			}
			ctx.ui.notify(
				enabled ? "pstack skills on." : "pstack skills off. Hidden from the model; /skill:<name> still works.",
				"info",
			);
		},
	});
}

async function pickScalarRole(
	ctx: ExtensionCommandContext,
	role: RoleName,
	choices: string[],
	current: RoleValue | undefined,
): Promise<RoleValue | undefined> {
	const choice = await ctx.ui.select(`Model for ${role}`, labeledChoices(choices, current));
	if (!choice) return undefined;
	return stripCurrentMark(choice);
}

async function pickListRole(
	ctx: ExtensionCommandContext,
	role: RoleName,
	choices: string[],
	current: RoleValue | undefined,
): Promise<RoleValue | undefined> {
	const first = await ctx.ui.select(`Model for ${role}`, labeledChoices(choices, current));
	if (!first) return undefined;
	const selected = stripCurrentMark(first);
	if (isInheritSelector(selected)) return selected;

	const picked = [selected];
	while (true) {
		const next = await ctx.ui.select("Add another model for this role?", ["done", ...choices]);
		if (!next) return undefined;
		if (next === "done") return picked;
		const value = stripCurrentMark(next);
		if (isInheritSelector(value)) return value;
		picked.push(value);
	}
}
