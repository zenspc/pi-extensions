/**
 * Model-specific thinking preferences for Pi.
 *
 * Pi's built-in defaultThinkingLevel is global. This extension applies a
 * preferred thinking level when switching to a model that has a mapping in:
 *
 *   $PI_CODING_AGENT_DIR/extensions/preferred-thinking.json
 *   (default: ~/.pi/agent/extensions/preferred-thinking.json)
 *
 * Invalid or missing values are ignored.
 *
 * Commands:
 *   /preferred-thinking              show preference for current model
 *   /preferred-thinking list         list all mappings
 *   /preferred-thinking set <level>  save + apply for current model
 *   /preferred-thinking clear        remove mapping for current model
 *   /preferred-thinking reload       re-read config from disk
 *   /preferred-thinking help
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	getConfigPath,
	isSafeModelKey,
	isValidThinkingLevel,
	loadPreferredThinkingConfig,
	modelKey,
	resolvePreferredLevel,
	savePreferredThinkingConfig,
	shouldApplyOnModelSelect,
	shouldApplyOnSessionStart,
	VALID_THINKING_LEVELS,
} from "./preferred-thinking-helpers.mjs";

type PreferredMap = Record<string, string>;

type ModelLike = {
	provider?: string;
	id?: string;
};

const USAGE =
	"Usage: /preferred-thinking [show|list|set <level>|clear|reload|help]\n" +
	`Levels: ${VALID_THINKING_LEVELS.join(", ")}`;

function currentModelKey(model: ModelLike | undefined | null): string | undefined {
	if (typeof model?.provider !== "string" || typeof model?.id !== "string") return undefined;
	const key = modelKey(model.provider, model.id);
	return isSafeModelKey(key) ? key : undefined;
}

function notify(ctx: ExtensionCommandContext | ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function preferredThinkingExtension(pi: ExtensionAPI) {
	let prefs: PreferredMap = loadPreferredThinkingConfig();
	const configPath = getConfigPath();

	function reload() {
		prefs = loadPreferredThinkingConfig();
		return prefs;
	}

	function persist(next: PreferredMap) {
		prefs = next;
		savePreferredThinkingConfig(prefs);
	}

	/**
	 * Apply preferred level for a model if configured and different from live level.
	 * Returns the applied level, or undefined when nothing changed.
	 */
	function applyForModel(model: ModelLike | undefined | null): string | undefined {
		if (typeof model?.provider !== "string" || typeof model?.id !== "string") return undefined;
		const preferred = resolvePreferredLevel(prefs, model.provider, model.id);
		if (!preferred) return undefined;
		const current = pi.getThinkingLevel();
		if (current === preferred) return undefined;
		// preferred is allowlisted by isValidThinkingLevel in resolvePreferredLevel.
		pi.setThinkingLevel(preferred as Parameters<typeof pi.setThinkingLevel>[0]);
		return preferred;
	}

	pi.on("session_start", async (event, ctx) => {
		if (!shouldApplyOnSessionStart(event.reason)) return;
		reload();
		applyForModel(ctx.model);
	});

	pi.on("model_select", async (event) => {
		if (!shouldApplyOnModelSelect(event.source)) return;
		reload();
		applyForModel(event.model);
	});

	pi.registerCommand("preferred-thinking", {
		description: "Manage per-model thinking preferences",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = (parts[0] ?? "show").toLowerCase();

			if (sub === "help") {
				notify(ctx, `${USAGE}\nConfig: ${configPath}`, "info");
				return;
			}

			if (sub === "reload") {
				reload();
				notify(ctx, `Reloaded ${Object.keys(prefs).length} preference(s) from ${configPath}`, "info");
				return;
			}

			if (sub === "list") {
				reload();
				const keys = Object.keys(prefs).sort();
				if (keys.length === 0) {
					notify(ctx, `No preferences configured.\nConfig: ${configPath}`, "info");
					return;
				}
				// Keys/levels are already sanitized; still treat as plain text only.
				const lines = keys.map((key) => `${key}: ${prefs[key]}`);
				notify(ctx, `Preferred thinking (${keys.length}):\n${lines.join("\n")}\n\nConfig: ${configPath}`, "info");
				return;
			}

			if (sub === "set") {
				const level = parts[1]?.toLowerCase();
				if (!isValidThinkingLevel(level)) {
					notify(ctx, `Invalid level. ${USAGE}`, "warning");
					return;
				}
				const key = currentModelKey(ctx.model);
				if (!key) {
					notify(ctx, "No active model to set a preference for.", "warning");
					return;
				}
				reload();
				const next: PreferredMap = Object.create(null);
				for (const [k, v] of Object.entries(prefs)) next[k] = v;
				next[key] = level;
				persist(next);
				// level is allowlisted by isValidThinkingLevel above.
				pi.setThinkingLevel(level as Parameters<typeof pi.setThinkingLevel>[0]);
				notify(ctx, `Preferred thinking for ${key}: ${level}`, "info");
				return;
			}

			if (sub === "clear") {
				const key = currentModelKey(ctx.model);
				if (!key) {
					notify(ctx, "No active model to clear a preference for.", "warning");
					return;
				}
				reload();
				if (!Object.hasOwn(prefs, key)) {
					notify(ctx, `No preference stored for ${key}.`, "info");
					return;
				}
				const next: PreferredMap = Object.create(null);
				for (const [k, v] of Object.entries(prefs)) {
					if (k !== key) next[k] = v;
				}
				persist(next);
				notify(ctx, `Cleared preferred thinking for ${key}. Live level unchanged.`, "info");
				return;
			}

			if (sub === "show" || parts.length === 0) {
				reload();
				const key = currentModelKey(ctx.model);
				if (!key) {
					notify(ctx, "No active model.", "warning");
					return;
				}
				const preferred = Object.hasOwn(prefs, key) ? prefs[key] : undefined;
				const live = pi.getThinkingLevel();
				const preferredText = preferred ? preferred : "(none)";
				notify(
					ctx,
					`Model: ${key}\nPreferred: ${preferredText}\nLive: ${live}\nConfig: ${configPath}`,
					"info",
				);
				return;
			}

			notify(ctx, USAGE, "warning");
		},
	});
}
