import { dirname, join, sep } from "node:path";
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
	formatPanelStatus,
	modelsForRole,
	isSafeModelSelector,
	loadConfig,
	migrateLegacyMarkdownIfNeeded,
	saveConfig,
} from "./config.ts";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

const POTETO_SKILL = "/skill:poteto-mode";
const POTETO_SKILL_PATH = join(SKILLS_DIR, "poteto-mode", "SKILL.md");
const POTETO_PROMPT = [
	"Poteto Mode is ON.",
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.",
	`Before work needing rigor, read the full skill at ${JSON.stringify(POTETO_SKILL_PATH)} if it is missing from the current context, including after compaction.`,
].join("\n");
const POTETO_OFF = "Poteto Mode is OFF. Ignore earlier Poteto Mode activation and mode-specific instructions unless the user enables it again.";

type PotetoMode = boolean | undefined;

export function systemPromptInjection(config: PstackConfig, potetoMode: PotetoMode): string {
	const parts: string[] = [];
	const table = formatRoleTable(config);
	if (table) parts.push(table);
	if (potetoMode === true) parts.push(POTETO_PROMPT);
	else if (potetoMode === false) parts.push(POTETO_OFF);
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

function lastPotetoEnabled(entries: ModeEntry[]): PotetoMode {
	let enabled: PotetoMode;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "pstack-mode" && typeof entry.data?.enabled === "boolean") {
			enabled = entry.data.enabled;
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

export default function pstackExtension(pi: ExtensionAPI): void {
	let potetoMode: PotetoMode;
	const configWarnings = new Set<string>();

	function report(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
		if (ctx.hasUI) ctx.ui.notify(message, type);
		else pi.sendMessage({ customType: "pstack-status", content: message, display: true });
	}

	function readConfig(ctx: ExtensionContext) {
		const result = loadConfig();
		const warning = `${result.path}\n${result.diagnostics.join("\n")}`;
		if (result.diagnostics.length && !configWarnings.has(warning)) {
			configWarnings.add(warning);
			report(ctx, `Pstack config ${result.status}: ${warning}\nUsing defaults for rejected settings; the file was not changed. Run /pstack status for details.`, "warning");
		}
		return result;
	}

	function canWriteConfig(ctx: ExtensionContext, result: ReturnType<typeof loadConfig>): boolean {
		if (result.status === "loaded" || result.status === "missing") return true;
		report(ctx, `Refusing to overwrite ${result.path}. Repair or move the existing configuration, then retry.`, "error");
		return false;
	}

	function setStatus(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setStatus("pstack-mode", potetoMode ? "pstack: poteto mode" : undefined);
	}

	function persistMode(enabled: boolean, ctx?: ExtensionContext): void {
		potetoMode = enabled;
		pi.appendEntry("pstack-mode", { enabled });
		if (ctx) setStatus(ctx);
	}

	function restoreMode(ctx: ExtensionContext): void {
		potetoMode = lastPotetoEnabled(sessionEntries(ctx));
		setStatus(ctx);
	}

	function requireSkill(ctx: ExtensionContext): boolean {
		if (pi.getCommands().some((command) => command.source === "skill" && command.name === "skill:poteto-mode")) return true;
		const message = "Poteto Mode requires its skill. Load the full pi-pstack package, not just its extension, and enable the poteto-mode skill.";
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		else pi.sendMessage({ customType: "pstack-error", content: message, display: true });
		return false;
	}

	pi.on("session_start", async (_event, ctx) => {
		restoreMode(ctx);
		try {
			migrateLegacyMarkdownIfNeeded();
		} catch {
			// ignore migration errors
		}
		readConfig(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => restoreMode(ctx));

	pi.on("input", async (event, ctx) => {
		if (/^\/skill:poteto-mode(?:\s|$)/.test(event.text)) {
			if (!requireSkill(ctx)) return { action: "handled" as const };
			persistMode(true, ctx);
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		restoreMode(ctx);
		const { config } = readConfig(ctx);
		const options = event.systemPromptOptions;
		if (!config.skillsEnabled) {
			options.skills = options.skills.filter((skill) => !skill.filePath.startsWith(`${SKILLS_DIR}${sep}`));
		}
		const extra = systemPromptInjection(config, potetoMode);
		if (extra) options.sections.pstack = extra;
		else delete options.sections.pstack;
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
			const token = raw.toLowerCase();
			if (token === "off" || token === "disable" || token === "stop") {
				persistMode(false, ctx);
				ctx.ui.notify("Poteto Mode off.", "info");
				return;
			}
			if (!requireSkill(ctx)) return;
			persistMode(true, ctx);
			ctx.ui.notify("Poteto Mode on. Stays on until /poteto-mode off.", "info");
			const payload = `${POTETO_SKILL}${raw ? ` ${raw}` : ""}`;
			const completion = pi.sendUserMessage(
				payload,
				ctx.isIdle()
					? { expandPromptTemplates: true }
					: { expandPromptTemplates: true, deliverAs: "followUp" },
			);
			// One-shot hosts dispose after the handler; RPC and TUI acknowledge commands before settlement.
			if (ctx.mode === "json" || ctx.mode === "print") await completion;
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
			const loaded = readConfig(ctx);
			if (!canWriteConfig(ctx, loaded)) return;
			const { path, config } = loaded;
			if (!ctx.hasUI) {
				if (loaded.status === "missing" && !saveConfig(defaultConfig(), path)) {
					report(ctx, `Failed to write ${path}`, "error");
					return;
				}
				report(ctx, `${loaded.status === "missing" ? "Wrote" : "Using"} ${path}`);
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
			const loaded = readConfig(ctx);
			const { config } = loaded;
			if (token === "" || token === "status") {
				const state = config.skillsEnabled ? "on" : "off";
				const hint = config.skillsEnabled ? "" : " Skills are hidden from the model; /skill:<name> still works.";
				const parent = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
				const available = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
				const unavailable = [...new Set(ROLE_NAMES.flatMap((role) => modelsForRole(config, role)))].filter(
					(selector) => selector !== "inherit-parent" && selector !== "auto" && !available.has(selector),
				);
				report(ctx, [
					`pstack is ${state}.${hint}`, `Config: ${loaded.path}`, `Load status: ${loaded.status}`,
					...loaded.diagnostics,
					`Parent session model: ${parent ?? "unresolved"}`,
					"Effective panel selectors (not a dispatch guarantee):", formatPanelStatus(config, parent),
					unavailable.length ? `Unavailable in this session: ${unavailable.join(", ")}` : "Configured model selectors are available in this session.",
					"Same-model panels are repeated samples, not cross-model review. For opt-in diversity, choose confirmed available models with /setup-pstack; no extra provider is selected automatically.",
				].join("\n"));
				return;
			}
			const enabled = token === "on" || token === "enable";
			if (!enabled && token !== "off" && token !== "disable") {
				ctx.ui.notify("Usage: /pstack [on|off|status]", "error");
				return;
			}
			if (!canWriteConfig(ctx, loaded)) return;
			if (enabled !== config.skillsEnabled) {
				config.skillsEnabled = enabled;
				if (!saveConfig(config)) {
					report(ctx, `Failed to write ${configPath()}`, "error");
					return;
				}
			}
			report(ctx,
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
	const picked = [selected];
	while (true) {
		const next = await ctx.ui.select("Add another model for this role?", ["done", ...choices]);
		if (!next) return undefined;
		if (next === "done") return picked;
		picked.push(stripCurrentMark(next));
	}
}
