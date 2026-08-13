/**
 * pi-spinner extension for pi.
 *
 * Replaces pi's default "Working..." loader text + braille spinner with a
 * user-chosen animation preset and a rotating list of messages.
 *
 * Customization sources (merged: defaults < global < project):
 *   - Global:    ~/.pi/agent/extensions/spinner.json
 *   - Project:   <cwd>/.pi/spinner.json
 *
 * Commands:
 *   /spinner                Open the interactive customization TUI
 *   /spinner status|help    Show merged config or usage
 *   /spinner <preset>       Set animation (saves to global)
 *   /spinner pack <name>    Replace messages with a built-in pack
 *   /spinner random|sequential
 *   /spinner rotate         Same as /spinner-rotate
 *   /spinner reset [global|project]
 *   /spinner-reset          Delete saved config (optional scoped target)
 *   /spinner-rotate         Force-advance to the next message
 *
 * Lifecycle:
 *   session_start    load config, apply indicator; start the message cycler
 *                    only when the user has customized something (the
 *                    README's "no rotation by default" promise).
 *   session_shutdown stop cycler (clears timer + restores default message)
 *
 * Mode behavior:
 *   The underlying setWorkingMessage / setWorkingIndicator APIs are no-ops
 *   outside of TUI mode. We additionally short-circuit session_start work
 *   when ctx.mode !== "tui" so we never spin a timer in rpc/json/print.
 *   Slash mutations still persist to disk in any mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	formatSpinnerHelp,
	formatSpinnerStatus,
	getSpinnerArgumentCompletions,
	parseSpinnerCommand,
	type SpinnerCommand,
} from "./command.ts";
import {
	deleteConfig,
	globalConfigPath,
	loadConfig,
	projectConfigPath,
	saveConfig,
	type UserSpinnerConfig,
} from "./config.ts";
import { MESSAGE_PACKS, type MessagePackName } from "./constants.ts";
import { MessageCycler } from "./cycler.ts";
import { buildIndicator, findPreset } from "./presets.ts";
import { runSpinnerMenu } from "./ui.ts";

export default function spinnerExtension(pi: ExtensionAPI) {
	// Per-session state. The session_start handler rebuilds this; the
	// session_shutdown handler tears it down. Closure-scoped so commands
	// registered in this factory instance see the current cycler.
	let cycler: MessageCycler | null = null;

	function startCycler(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		const cfg = loadConfig(ctx.cwd);

		// Indicator: apply once, pi persists it across loader recreations.
		ctx.ui.setWorkingIndicator(
			buildIndicator(cfg.preset, cfg.customFrames, cfg.customIntervalMs, ctx.ui.theme),
		);

		// Cycler: rotate messages on a timer. Only spin one when the user
		// has actually configured something - this honours the README's
		// "no rotation by default" promise for a clean install.
		if (!cfg.customized) return;

		cycler = new MessageCycler({
			messages: cfg.messages,
			intervalMs: cfg.cycleIntervalMs,
			cycleMode: cfg.cycleMode,
			ctx,
		});
		cycler.start();
	}

	function stopCycler(): void {
		if (!cycler) return;
		cycler.stop();
		cycler = null;
	}

	function refreshLive(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		stopCycler();
		startCycler(ctx);
	}

	function saveGlobal(partial: UserSpinnerConfig, ctx: ExtensionContext): boolean {
		try {
			saveConfig("global", partial, ctx.cwd);
			return true;
		} catch (err) {
			ctx.ui.notify(`Save failed: ${err instanceof Error ? err.message : err}`, "error");
			return false;
		}
	}

	function rotateNow(ctx: ExtensionContext): void {
		if (!cycler || !cycler.isRunning) {
			ctx.ui.notify("Cycler is not running", "warning");
			return;
		}
		cycler.tickNow();
	}

	function openMenu(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/spinner requires TUI mode", "warning");
			return Promise.resolve();
		}
		const cfg = loadConfig(ctx.cwd);
		// Spin up a temporary cycler for live preview if the user hasn't
		// saved any config yet. The cycler dies with the session; on next
		// session_start, loadConfig() will report customized=false again
		// and no cycler is started unless the user has saved something.
		if (!cycler) {
			cycler = new MessageCycler({
				messages: cfg.messages,
				intervalMs: cfg.cycleIntervalMs,
				cycleMode: cfg.cycleMode,
				ctx,
			});
			cycler.start();
		}
		return runSpinnerMenu({ initial: cfg, cycler, ctx });
	}

	function applySpinnerCommand(cmd: SpinnerCommand, ctx: ExtensionContext): void | Promise<void> {
		const paths = { global: globalConfigPath(), project: projectConfigPath(ctx.cwd) };

		switch (cmd.action) {
			case "menu":
				return openMenu(ctx);
			case "help":
				ctx.ui.notify(formatSpinnerHelp(paths), "info");
				return;
			case "status":
				ctx.ui.notify(formatSpinnerStatus(loadConfig(ctx.cwd), paths), "info");
				return;
			case "unknown":
				ctx.ui.notify(formatSpinnerHelp(paths), "warning");
				return;
			case "rotate":
				rotateNow(ctx);
				return;
			case "preset": {
				if (!saveGlobal({ preset: cmd.name }, ctx)) return;
				refreshLive(ctx);
				ctx.ui.notify(`Animation: ${findPreset(cmd.name)?.label ?? cmd.name}`, "info");
				return;
			}
			case "pack": {
				const name = cmd.name as MessagePackName;
				const messages = [...MESSAGE_PACKS[name]];
				if (!saveGlobal({ messagePack: name, messages }, ctx)) return;
				refreshLive(ctx);
				ctx.ui.notify(`Messages replaced with the ${name} pack (${messages.length})`, "info");
				return;
			}
			case "cycleMode": {
				if (!saveGlobal({ cycleMode: cmd.mode }, ctx)) return;
				if (cycler?.isRunning) {
					const cfg = loadConfig(ctx.cwd);
					cycler.update(cfg.messages, cfg.cycleIntervalMs, cmd.mode);
				} else {
					refreshLive(ctx);
				}
				ctx.ui.notify(`Cycle order: ${cmd.mode}`, "info");
				return;
			}
			case "reset": {
				stopCycler();
				if (cmd.target === "all") {
					ctx.ui.setWorkingMessage();
					ctx.ui.setWorkingIndicator();
					deleteConfig("global", ctx.cwd);
					deleteConfig("project", ctx.cwd);
					ctx.ui.notify("Spinner reset to defaults", "info");
					return;
				}
				deleteConfig(cmd.target, ctx.cwd);
				startCycler(ctx);
				ctx.ui.notify(`Spinner reset (${cmd.target})`, "info");
				return;
			}
		}
	}

	function spinnerCompletions(prefix: string) {
		if (typeof getSpinnerArgumentCompletions !== "function") return null;
		try {
			return getSpinnerArgumentCompletions(prefix);
		} catch {
			return null;
		}
	}

	function resetCompletions(prefix: string) {
		try {
			const start = (typeof prefix === "string" ? prefix : "").trim().toLowerCase();
			if (start.includes(" ")) return null;
			const items = (["global", "project"] as const)
				.filter((name) => name.startsWith(start))
				.map((name) => ({ value: name, label: name }));
			return items.length > 0 ? items : null;
		} catch {
			return null;
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// Defensive: if a previous session left a cycler running somehow,
		// make sure it's stopped before we install a new one.
		stopCycler();
		startCycler(ctx);
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		stopCycler();
	});

	// ── Commands ─────────────────────────────────────────────────────────

	pi.registerCommand("spinner", {
		description: "Customize the spinner animation and message rotation.",
		getArgumentCompletions: spinnerCompletions,
		handler: async (args, ctx) => {
			await applySpinnerCommand(parseSpinnerCommand(args), ctx);
		},
	});

	pi.registerCommand("spinner-reset", {
		description: "Restore pi's default spinner and clear the message rotation.",
		getArgumentCompletions: resetCompletions,
		handler: async (args, ctx) => {
			const cmd = parseSpinnerCommand(`reset ${args ?? ""}`);
			if (cmd.action !== "reset") {
				ctx.ui.notify(formatSpinnerHelp({
					global: globalConfigPath(),
					project: projectConfigPath(ctx.cwd),
				}), "warning");
				return;
			}
			await applySpinnerCommand(cmd, ctx);
		},
	});

	pi.registerCommand("spinner-rotate", {
		description: "Force-advance to the next message in the rotation (for previewing).",
		handler: async (_args, ctx) => {
			rotateNow(ctx);
		},
	});
}
