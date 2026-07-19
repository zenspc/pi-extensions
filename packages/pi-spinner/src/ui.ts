/**
 * Interactive /spinner TUI.
 *
 * Implementation: a sequence of simple UI calls. The "main" screen is a
 * SelectList; each action delegates to a sub-UI (SelectList, editor, or
 * input dialog) and then we loop back to the main screen. This avoids a
 * full state machine while still giving the user a multi-step experience.
 *
 * Live preview: every state mutation calls applyPreview() which updates
 * the working indicator and tickles the message cycler so the change is
 * visible immediately.
 */

import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SelectItem,
	SelectList,
	Text,
	type Component,
	type Theme,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	defaults,
	type SpinnerConfig,
	type UserSpinnerConfig,
	type SaveTarget,
	globalConfigPath,
	projectConfigPath,
	saveConfig,
	sanitizeMessage,
	LIMITS,
} from "./config.ts";
import type { MessageCycler } from "./cycler.ts";
import { PRESETS, findPreset, buildIndicator } from "./presets.ts";

type MainAction = "animation" | "messages" | "interval" | "save" | "reset" | "close";

const MAIN_ITEMS: SelectItem<MainAction>[] = [
	{ value: "animation", label: "Animation preset", description: "change the spinner" },
	{ value: "messages", label: "Messages", description: "edit the message list" },
	{ value: "interval", label: "Cycle interval", description: "how often to switch messages" },
	{ value: "save", label: "Save settings", description: "write to global or project" },
	{ value: "reset", label: "Reset to defaults", description: "restore built-in animation + messages" },
	{ value: "close", label: "Close", description: "discard unsaved changes" },
];

export interface SpinnerMenuOptions {
	initial: SpinnerConfig;
	cycler: MessageCycler | null;
	ctx: ExtensionContext;
}

export async function runSpinnerMenu(opts: SpinnerMenuOptions): Promise<void> {
	const { ctx } = opts;
	if (ctx.mode !== "tui") {
		ctx.ui.notify("pi-spinner requires TUI mode", "warning");
		return;
	}

	const state: SpinnerConfig = { ...opts.initial, messages: [...opts.initial.messages] };
	const cycler = opts.cycler;

	// Apply current config on entry so the user sees their live state
	applyPreview(state, cycler, ctx);

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const action = await pickMainAction(state, ctx);
		if (action === "close") return;

		switch (action) {
			case "animation":
				await pickAnimation(state, cycler, ctx);
				break;
			case "messages":
				await editMessages(state, cycler, ctx);
				break;
			case "interval":
				await editInterval(state, cycler, ctx);
				break;
			case "save":
				await pickSaveTarget(state, ctx);
				break;
			case "reset":
				await handleReset(state, cycler, ctx);
				break;
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-screens
// ────────────────────────────────────────────────────────────────────────────

interface SelectScreenOptions<T> {
	title: string;
	items: SelectItem<T>[];
	headerLines?: readonly string[];
	hint: string;
	cancelValue: T;
	maxVisible?: number;
}

/**
 * Build the shared SelectList screen scaffold: top border, title, optional
 * status header, SelectList with the standard theme, hint line, bottom border.
 * Returns a Component suitable for `ctx.ui.custom()`.
 */
function buildSelectScreen<T>(
	opts: SelectScreenOptions<T>,
	tui: TUI,
	theme: Theme,
	done: (v: T) => void,
): Component {
	const { title, items, headerLines, hint, cancelValue, maxVisible = 10 } = opts;

	const container = new Container();
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
	container.addChild(new Text("", 1, 0));

	if (headerLines) {
		for (const line of headerLines) {
			container.addChild(new Text(theme.fg("muted", line), 1, 0));
		}
		container.addChild(new Text("", 1, 0));
	}

	const selectList = new SelectList<T>(items, Math.min(items.length + 2, maxVisible), {
		selectedPrefix: (t) => theme.fg("accent", t),
		selectedText: (t) => theme.fg("accent", t),
		description: (t) => theme.fg("muted", t),
		scrollInfo: (t) => theme.fg("dim", t),
		noMatch: (t) => theme.fg("warning", t),
	});
	selectList.onSelect = (item) => done(item.value);
	selectList.onCancel = () => done(cancelValue);
	container.addChild(selectList);

	container.addChild(new Text("", 1, 0));
	container.addChild(new Text(theme.fg("dim", hint), 1, 0));
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

	return {
		render(width: number) {
			return container.render(width);
		},
		invalidate() {
			container.invalidate();
		},
		handleInput(data: string) {
			selectList.handleInput?.(data);
			tui.requestRender();
		},
	};
}

function formatSeconds(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

async function pickMainAction(state: SpinnerConfig, ctx: ExtensionContext): Promise<MainAction> {
	const presetLabel = findPreset(state.preset)?.label ?? state.preset;
	const cycleLabel = formatSeconds(state.cycleIntervalMs);
	const items: SelectItem<MainAction>[] = MAIN_ITEMS.map((item) => {
		if (item.value === "animation") return { ...item, description: presetLabel };
		if (item.value === "messages") return { ...item, description: `${state.messages.length} entries` };
		if (item.value === "interval") return { ...item, description: cycleLabel };
		return item;
	});

	return ctx.ui
		.custom<MainAction>((tui, theme, _kb, done) =>
			buildSelectScreen<MainAction>(
				{
					title: "pi-spinner",
					items,
					headerLines: [
						`  preset: ${presetLabel}`,
						`  messages: ${state.messages.length}  ·  cycle: ${cycleLabel}`,
					],
					hint: "↑↓ navigate · enter select · esc close",
					cancelValue: "close",
				},
				tui,
				theme,
				done,
			),
		)
		.then((v) => v ?? "close");
}

async function pickAnimation(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const items: SelectItem<string>[] = PRESETS.map((p) => ({
		value: p.name,
		label: `${state.preset === p.name ? "● " : "  "}${p.label}`,
		description: p.description,
	}));
	items.push({ value: "__back__", label: "Back", description: "return to main menu" });

	const result = await ctx.ui.custom<string>((tui, theme, _kb, done) =>
		buildSelectScreen<string>(
			{ title: "Animation Preset", items, hint: "enter to apply · esc back", cancelValue: "__back__" },
			tui,
			theme,
			done,
		),
	);

	if (result && result !== "__back__") {
		state.preset = result;
		applyPreview(state, cycler, ctx);
		ctx.ui.notify(`Animation: ${findPreset(result)?.label ?? result}`, "info");
	}
}

async function editMessages(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const prefill = state.messages.join("\n");
	const edited = await ctx.ui.editor("Edit messages (one per line)", prefill);
	if (edited === undefined) return; // cancelled

	const next: string[] = [];
	for (const line of edited.split(/\r?\n/)) {
		if (next.length >= LIMITS.MAX_MESSAGES) break;
		const msg = sanitizeMessage(line);
		if (msg) next.push(msg);
	}

	if (next.length === 0) {
		ctx.ui.notify("Need at least one message", "error");
		return;
	}

	state.messages = next;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Messages updated: ${next.length} entries`, "info");
}

async function editInterval(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const current = formatSeconds(state.cycleIntervalMs);
	const raw = await ctx.ui.input("Cycle interval (seconds)", current);
	if (raw === undefined) return;

	const seconds = Number.parseFloat(raw.trim());
	if (!Number.isFinite(seconds) || seconds <= 0) {
		ctx.ui.notify("Invalid number", "error");
		return;
	}

	const ms = Math.round(seconds * 1000);
	if (ms < LIMITS.MIN_INTERVAL_MS || ms > LIMITS.MAX_INTERVAL_MS) {
		ctx.ui.notify(
			`Must be between ${formatSeconds(LIMITS.MIN_INTERVAL_MS)} and ${formatSeconds(LIMITS.MAX_INTERVAL_MS)}`,
			"error",
		);
		return;
	}

	state.cycleIntervalMs = ms;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Cycle interval: ${formatSeconds(state.cycleIntervalMs)}`, "info");
}

async function pickSaveTarget(state: SpinnerConfig, ctx: ExtensionContext): Promise<void> {
	const items: SelectItem<SaveTarget | "cancel">[] = [
		{ value: "global", label: "Save to global", description: globalConfigPath() },
		{ value: "project", label: "Save to project", description: projectConfigPath(ctx.cwd) },
		{ value: "cancel", label: "Cancel", description: "do not save" },
	];

	const result = await ctx.ui
		.custom<SaveTarget | "cancel">((tui, theme, _kb, done) =>
			buildSelectScreen<SaveTarget | "cancel">(
				{
					title: "Save Settings",
					items,
					headerLines: [
						`  preset: ${state.preset}`,
						`  messages: ${state.messages.length}`,
						`  cycle: ${formatSeconds(state.cycleIntervalMs)}`,
					],
					hint: "enter to save · esc cancel",
					cancelValue: "cancel",
				},
				tui,
				theme,
				done,
			),
		);

	if (result === "global" || result === "project") {
		try {
			// Only persist allowlisted user fields - never write `customized` or other runtime state.
			const partial: UserSpinnerConfig = {
				preset: state.preset,
				messages: state.messages,
				cycleIntervalMs: state.cycleIntervalMs,
				customFrames: state.customFrames,
				customIntervalMs: state.customIntervalMs,
			};
			const { path } = saveConfig(result, partial, ctx.cwd);
			ctx.ui.notify(`Saved to ${result}: ${path}`, "info");
		} catch (err) {
			ctx.ui.notify(`Save failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	}
}

async function handleReset(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const confirmed = await ctx.ui.confirm(
		"Reset to defaults?",
		"This will revert the live animation + messages to built-in defaults. Saved config files are not deleted.",
	);
	if (!confirmed) return;

	ctx.ui.setWorkingMessage();
	ctx.ui.setWorkingIndicator();

	// Single source of truth: copy from defaults() so the un-customized state
	// is consistent with what loadConfig() will produce on the next session.
	const d = defaults();
	state.preset = d.preset;
	state.messages = [...d.messages];
	state.cycleIntervalMs = d.cycleIntervalMs;
	state.customFrames = [...d.customFrames];
	state.customIntervalMs = d.customIntervalMs;

	if (cycler) {
		cycler.update(state.messages, state.cycleIntervalMs);
		if (cycler.isRunning) cycler.tickNow();
	}
	ctx.ui.notify("Reset to defaults", "info");
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function applyPreview(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): void {
	const indicator = buildIndicator(state.preset, state.customFrames, state.customIntervalMs, ctx.ui.theme);
	ctx.ui.setWorkingIndicator(indicator);
	if (cycler) {
		cycler.update(state.messages, state.cycleIntervalMs);
		// Force an immediate tick so the new state is visible right away
		if (cycler.isRunning) cycler.tickNow();
	}
}
