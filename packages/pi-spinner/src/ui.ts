/**
 * Interactive /spinner TUI.
 *
 * Implementation: a sequence of simple UI calls. The "main" screen is a
 * SelectList; each action delegates to a sub-UI (SelectList, editor, or
 * input dialog) and then we loop back to the main screen. This avoids a
 * full state machine while still giving the user a multi-step experience.
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
	sanitizeFrame,
	LIMITS,
} from "./config.ts";
import {
	CYCLE_MODES,
	MESSAGE_PACKS,
	MESSAGE_PACK_NAMES,
	type CycleMode,
	type MessagePackName,
} from "./constants.ts";
import type { MessageCycler } from "./cycler.ts";
import { PRESETS, findPreset, buildIndicator } from "./presets.ts";
import {
	advancePreview,
	createPresetPreview,
	formatPreviewHeader,
	previewTickMs,
	type PresetPreview,
} from "./preview.ts";

type MainAction =
	| "animation"
	| "messages"
	| "interval"
	| "frames"
	| "frameInterval"
	| "cycleMode"
	| "pack"
	| "activity"
	| "thinking"
	| "save"
	| "reset"
	| "close";

const MAIN_ITEMS: SelectItem<MainAction>[] = [
	{ value: "animation", label: "Animation preset", description: "change the spinner" },
	{ value: "messages", label: "Messages", description: "edit the message list" },
	{ value: "interval", label: "Cycle interval", description: "how often to switch messages" },
	{ value: "frames", label: "Custom frames", description: "override the preset with raw frames" },
	{ value: "frameInterval", label: "Frame interval", description: "speed of custom frames" },
	{ value: "cycleMode", label: "Cycle order", description: "random or sequential" },
	{ value: "pack", label: "Message pack", description: "replace the list with a built-in pack" },
	{ value: "activity", label: "Activity messages", description: "show the current tool while it runs" },
	{ value: "thinking", label: "Thinking label", description: "sync the loader message to the Ctrl+T label" },
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
			case "frames":
				await editCustomFrames(state, cycler, ctx);
				break;
			case "frameInterval":
				await editFrameInterval(state, cycler, ctx);
				break;
			case "cycleMode":
				await pickCycleMode(state, cycler, ctx);
				break;
			case "pack":
				await pickMessagePack(state, cycler, ctx);
				break;
			case "activity":
				state.activityMessages = !state.activityMessages;
				ctx.ui.notify(`Activity messages: ${state.activityMessages ? "on" : "off"}`, "info");
				break;
			case "thinking":
				state.syncThinkingLabel = !state.syncThinkingLabel;
				ctx.ui.notify(`Thinking label: ${state.syncThinkingLabel ? "on" : "off"}`, "info");
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
	liveHeaderLines?: () => readonly string[];
	hint: string;
	cancelValue: T;
	maxVisible?: number;
	selectedIndex?: number;
	onSelectionChange?: (item: SelectItem<T>) => void;
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
	const { title, items, headerLines, liveHeaderLines, hint, cancelValue, maxVisible = 10 } = opts;

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

	if (liveHeaderLines) {
		container.addChild(liveLines(liveHeaderLines));
		container.addChild(new Text("", 1, 0));
	}

	const selectList = new SelectList<T>(items, Math.min(items.length + 2, maxVisible), {
		selectedPrefix: (t) => theme.fg("accent", t),
		selectedText: (t) => theme.fg("accent", t),
		description: (t) => theme.fg("muted", t),
		scrollInfo: (t) => theme.fg("dim", t),
		noMatch: (t) => theme.fg("warning", t),
	});
	if (opts.selectedIndex !== undefined) {
		selectList.setSelectedIndex(opts.selectedIndex);
	}
	selectList.onSelect = (item) => done(item.value);
	selectList.onCancel = () => done(cancelValue);
	if (opts.onSelectionChange) {
		selectList.onSelectionChange = opts.onSelectionChange;
	}
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
		if (item.value === "frames") {
			const n = state.customFrames.length;
			return { ...item, description: n === 0 ? "off" : `${n} frames (overrides preset)` };
		}
		if (item.value === "frameInterval") return { ...item, description: `${state.customIntervalMs}ms` };
		if (item.value === "cycleMode") return { ...item, description: state.cycleMode };
		if (item.value === "pack") return { ...item, description: state.messagePack };
		if (item.value === "activity") return { ...item, description: state.activityMessages ? "on" : "off" };
		if (item.value === "thinking") return { ...item, description: state.syncThinkingLabel ? "on" : "off" };
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
						`  custom frames: ${state.customFrames.length || "off"}`,
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
	const selectedIndex = Math.max(
		0,
		PRESETS.findIndex((p) => p.name === state.preset),
	);

	let stopPreview = (): void => {};
	const result = await ctx.ui.custom<string>((tui, theme, _kb, done) => {
		let preview: PresetPreview | null = createPresetPreview(state.preset, theme);
		let timer: ReturnType<typeof setTimeout> | undefined;

		const stop = (): void => {
			if (timer === undefined) return;
			clearTimeout(timer);
			timer = undefined;
		};
		stopPreview = stop;

		const schedule = (): void => {
			stop();
			const ms = previewTickMs(preview);
			if (ms === null) return;
			timer = setTimeout(() => {
				if (!preview) return;
				preview = advancePreview(preview);
				tui.requestRender();
				schedule();
			}, ms);
		};

		const finish = (value: string): void => {
			stop();
			done(value);
		};

		const show = (name: string): void => {
			preview = createPresetPreview(name, theme) ?? createPresetPreview(state.preset, theme);
			schedule();
		};

		schedule();

		return buildSelectScreen<string>(
			{
				title: "Animation Preset",
				items,
				liveHeaderLines: () => [formatPreviewHeader(preview, theme)],
				hint: "↑↓ preview · enter apply · esc back",
				cancelValue: "__back__",
				selectedIndex,
				onSelectionChange: (item) => {
					show(item.value === "__back__" ? state.preset : item.value);
				},
			},
			tui,
			theme,
			finish,
		);
	}).finally(() => {
		stopPreview();
	});

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

async function editCustomFrames(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const prefill = state.customFrames.join("\n");
	const edited = await ctx.ui.editor("Edit custom frames (one per line; empty clears)", prefill);
	if (edited === undefined) return;

	const next: string[] = [];
	for (const line of edited.split(/\r?\n/)) {
		if (next.length >= LIMITS.MAX_CUSTOM_FRAMES) break;
		const frame = sanitizeFrame(line);
		if (frame) next.push(frame);
	}

	if (next.length === 0) {
		state.customFrames = [];
		applyPreview(state, cycler, ctx);
		ctx.ui.notify("Custom frames cleared; preset is active", "info");
		return;
	}

	state.customFrames = next;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Custom frames updated: ${next.length} frames`, "info");
}

async function editFrameInterval(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const raw = await ctx.ui.input("Frame interval (milliseconds)", String(state.customIntervalMs));
	if (raw === undefined) return;

	const ms = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(ms) || ms <= 0) {
		ctx.ui.notify("Invalid number", "error");
		return;
	}

	if (ms < LIMITS.MIN_FRAME_INTERVAL_MS || ms > LIMITS.MAX_FRAME_INTERVAL_MS) {
		ctx.ui.notify(
			`Must be between ${LIMITS.MIN_FRAME_INTERVAL_MS}ms and ${LIMITS.MAX_FRAME_INTERVAL_MS}ms`,
			"error",
		);
		return;
	}

	state.customIntervalMs = ms;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Frame interval: ${state.customIntervalMs}ms`, "info");
}

async function pickCycleMode(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const items: SelectItem<CycleMode | "__back__">[] = CYCLE_MODES.map((mode) => ({
		value: mode,
		label: `${state.cycleMode === mode ? "● " : "  "}${mode}`,
		description: mode === "random" ? "shuffle, avoid immediate repeat" : "walk the list in order",
	}));
	items.push({ value: "__back__", label: "Back", description: "return to main menu" });

	const result = await ctx.ui.custom<CycleMode | "__back__">((tui, theme, _kb, done) =>
		buildSelectScreen<CycleMode | "__back__">(
			{ title: "Cycle Order", items, hint: "enter to apply · esc back", cancelValue: "__back__" },
			tui,
			theme,
			done,
		),
	);

	if (result && result !== "__back__") {
		state.cycleMode = result;
		applyPreview(state, cycler, ctx);
		ctx.ui.notify(`Cycle order: ${result}`, "info");
	}
}

async function pickMessagePack(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const items: SelectItem<MessagePackName | "__back__">[] = MESSAGE_PACK_NAMES.map((name) => ({
		value: name,
		label: `${state.messagePack === name ? "● " : "  "}${name}`,
		description: MESSAGE_PACKS[name][0] ?? name,
	}));
	items.push({ value: "__back__", label: "Back", description: "return to main menu" });

	const result = await ctx.ui.custom<MessagePackName | "__back__">((tui, theme, _kb, done) =>
		buildSelectScreen<MessagePackName | "__back__">(
			{ title: "Message Pack", items, hint: "enter to apply · esc back", cancelValue: "__back__" },
			tui,
			theme,
			done,
		),
	);

	if (result && result !== "__back__") {
		state.messagePack = result;
		state.messages = [...MESSAGE_PACKS[result]];
		applyPreview(state, cycler, ctx);
		ctx.ui.notify(`Messages replaced with the ${result} pack`, "info");
	}
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
				messagePack: state.messagePack,
				cycleIntervalMs: state.cycleIntervalMs,
				cycleMode: state.cycleMode,
				customFrames: state.customFrames,
				customIntervalMs: state.customIntervalMs,
				activityMessages: state.activityMessages,
				syncThinkingLabel: state.syncThinkingLabel,
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
	state.messagePack = d.messagePack;
	state.cycleIntervalMs = d.cycleIntervalMs;
	state.cycleMode = d.cycleMode;
	state.customFrames = [...d.customFrames];
	state.customIntervalMs = d.customIntervalMs;
	state.activityMessages = d.activityMessages;
	state.syncThinkingLabel = d.syncThinkingLabel;

	if (cycler) {
		cycler.update(state.messages, state.cycleIntervalMs, state.cycleMode);
		if (cycler.isRunning) cycler.tickNow();
	}
	ctx.ui.notify("Reset to defaults", "info");
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function liveLines(getLines: () => readonly string[]): Component {
	return {
		render() {
			return [...getLines()];
		},
		invalidate() {},
	};
}

function applyPreview(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): void {
	const indicator = buildIndicator(state.preset, state.customFrames, state.customIntervalMs, ctx.ui.theme);
	ctx.ui.setWorkingIndicator(indicator);
	if (cycler) {
		cycler.update(state.messages, state.cycleIntervalMs, state.cycleMode);
		// Force an immediate tick so the new state is visible right away
		if (cycler.isRunning) cycler.tickNow();
	}
}
