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
 *   /spinner          Open the interactive customization TUI
 *   /spinner-reset    Delete saved config and restore pi's defaults
 *   /spinner-rotate   Force-advance to the next message (useful for previewing)
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
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { deleteConfig, loadConfig } from "./config.ts";
import { MessageCycler } from "./cycler.ts";
import { buildIndicator } from "./presets.ts";
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
			ctx,
		});
		cycler.start();
	}

	function stopCycler(): void {
		if (!cycler) return;
		cycler.stop();
		cycler = null;
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
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/spinner requires TUI mode", "warning");
				return;
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
					ctx,
				});
				cycler.start();
			}
			await runSpinnerMenu({ initial: cfg, cycler, ctx });
		},
	});

	pi.registerCommand("spinner-reset", {
		description: "Restore pi's default spinner and clear the message rotation.",
		handler: async (_args, ctx) => {
			stopCycler();
			ctx.ui.setWorkingMessage();
			ctx.ui.setWorkingIndicator();
			// Durable: delete both saved files so the next session_start
			// sees customized=false and skips the cycler entirely. Without
			// this, /spinner-reset would only last one session.
			deleteConfig("global", ctx.cwd);
			deleteConfig("project", ctx.cwd);
			ctx.ui.notify("Spinner reset to defaults", "info");
		},
	});

	pi.registerCommand("spinner-rotate", {
		description: "Force-advance to the next message in the rotation (for previewing).",
		handler: async (_args, ctx) => {
			if (!cycler || !cycler.isRunning) {
				ctx.ui.notify("Cycler is not running", "warning");
				return;
			}
			cycler.tickNow();
		},
	});
}
