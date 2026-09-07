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
	deleteCustom,
	findCustom,
	isValidCustomName,
	type SpinnerConfig,
	type UserSpinnerConfig,
	type SaveTarget,
	globalConfigPath,
	projectConfigPath,
	saveConfig,
	sanitizeMessage,
	sanitizeFrame,
	upsertCustom,
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
import { PRESETS, buildIndicator, resolveAnimation } from "./presets.ts";
import {
	advancePreview,
	createAnimationPreview,
	formatPreviewHeader,
	previewTickMs,
	type PresetPreview,
} from "./preview.ts";

type MainAction =
	| "animation"
	| "editCustom"
	| "messages"
	| "interval"
	| "cycleMode"
	| "pack"
	| "activity"
	| "thinking"
	| "save"
	| "reset"
	| "close";

const MAIN_ITEMS: SelectItem<MainAction>[] = [
	{ value: "animation", label: "Animation", description: "change the spinner" },
	{ value: "messages", label: "Messages", description: "edit the message list" },
	{ value: "interval", label: "Cycle interval", description: "how often to switch messages" },
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

	const state: SpinnerConfig = {
		...opts.initial,
		messages: [...opts.initial.messages],
		customs: [...opts.initial.customs],
	};
	const cycler = opts.cycler;

	applyPreview(state, cycler, ctx);

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const action = await pickMainAction(state, ctx);
		if (action === "close") return;

		switch (action) {
			case "animation":
				await pickAnimation(state, cycler, ctx);
				break;
			case "editCustom":
				await editActiveCustom(state, cycler, ctx);
				break;
			case "messages":
				await editMessages(state, cycler, ctx);
				break;
			case "interval":
				await editInterval(state, cycler, ctx);
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

function parseFrameList(edited: string): string[] {
	const next: string[] = [];
	for (const line of edited.split(/\r?\n/)) {
		if (next.length >= LIMITS.MAX_CUSTOM_FRAMES) break;
		const frame = sanitizeFrame(line);
		if (frame) next.push(frame);
	}
	return next;
}

async function pickMainAction(state: SpinnerConfig, ctx: ExtensionContext): Promise<MainAction> {
	const anim = resolveAnimation(state);
	const cycleLabel = formatSeconds(state.cycleIntervalMs);
	const activeCustom = findCustom(state.customs, state.preset);
	const items: SelectItem<MainAction>[] = [];
	for (const item of MAIN_ITEMS) {
		if (item.value === "animation") {
			items.push({ ...item, description: anim.label });
			if (activeCustom) {
				items.push({
					value: "editCustom",
					label: "Edit custom",
					description: `${activeCustom.name} · ${activeCustom.frames.length} frames`,
				});
			}
			continue;
		}
		if (item.value === "messages") {
			items.push({ ...item, description: `${state.messages.length} entries` });
			continue;
		}
		if (item.value === "interval") {
			items.push({ ...item, description: cycleLabel });
			continue;
		}
		if (item.value === "cycleMode") {
			items.push({ ...item, description: state.cycleMode });
			continue;
		}
		if (item.value === "pack") {
			items.push({ ...item, description: state.messagePack });
			continue;
		}
		if (item.value === "activity") {
			items.push({ ...item, description: state.activityMessages ? "on" : "off" });
			continue;
		}
		if (item.value === "thinking") {
			items.push({ ...item, description: state.syncThinkingLabel ? "on" : "off" });
			continue;
		}
		items.push(item);
	}

	return ctx.ui
		.custom<MainAction>((tui, theme, _kb, done) =>
			buildSelectScreen<MainAction>(
				{
					title: "pi-spinner",
					items,
					headerLines: [
						`  animation: ${anim.label}`,
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
	for (const custom of state.customs) {
		items.push({
			value: custom.name,
			label: `${state.preset === custom.name ? "● " : "  "}${custom.name}`,
			description: `${custom.frames.length} frames`,
		});
	}
	items.push({ value: "__new__", label: "New custom…", description: "name, frames, interval" });
	items.push({ value: "__back__", label: "Back", description: "return to main menu" });

	const builtinIdx = PRESETS.findIndex((p) => p.name === state.preset);
	const customIdx = state.customs.findIndex((entry) => entry.name === state.preset);
	const selectedIndex =
		builtinIdx >= 0 ? builtinIdx : customIdx >= 0 ? PRESETS.length + customIdx : 0;

	let stopPreview = (): void => {};
	const result = await ctx.ui.custom<string>((tui, theme, _kb, done) => {
		let preview: PresetPreview | null = createAnimationPreview(state, state.preset, theme);
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
			preview = createAnimationPreview(state, name, theme) ?? createAnimationPreview(state, state.preset, theme);
			schedule();
		};

		schedule();

		return buildSelectScreen<string>(
			{
				title: "Animation",
				items,
				liveHeaderLines: () => [formatPreviewHeader(preview, theme)],
				hint: "↑↓ preview · enter apply · esc back",
				cancelValue: "__back__",
				selectedIndex,
				onSelectionChange: (item) => {
					show(item.value === "__back__" || item.value === "__new__" ? state.preset : item.value);
				},
			},
			tui,
			theme,
			finish,
		);
	}).finally(() => {
		stopPreview();
	});

	if (!result || result === "__back__") return;
	if (result === "__new__") {
		await createCustom(state, cycler, ctx);
		return;
	}

	state.preset = result;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Animation: ${resolveAnimation(state).label}`, "info");
}

async function createCustom(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const rawName = await ctx.ui.input("Custom name (lowercase letters, digits, hyphens)", "");
	if (rawName === undefined) return;
	const name = rawName.trim().toLowerCase();
	if (!isValidCustomName(name)) {
		ctx.ui.notify("Name must be a unique identifier, not a built-in or slash verb", "error");
		return;
	}
	const existing = findCustom(state.customs, name);
	if (!existing && state.customs.length >= LIMITS.MAX_CUSTOM_SPINNERS) {
		ctx.ui.notify(`At most ${LIMITS.MAX_CUSTOM_SPINNERS} custom animations`, "error");
		return;
	}
	if (existing) {
		const confirmed = await ctx.ui.confirm(
			"Replace custom animation?",
			`"${name}" already exists. Save these frames over it.`,
		);
		if (!confirmed) return;
	}

	const edited = await ctx.ui.editor("Custom frames (one per line)", "");
	if (edited === undefined) return;
	const frames = parseFrameList(edited);
	if (frames.length === 0) {
		ctx.ui.notify("Need at least one frame", "error");
		return;
	}

	const intervalMs = await promptFrameInterval(ctx, 100);
	if (intervalMs === undefined) return;

	state.customs = upsertCustom(state.customs, { name, frames, intervalMs });
	state.preset = name;
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Animation: ${name}`, "info");
}

async function editActiveCustom(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const current = findCustom(state.customs, state.preset);
	if (!current) return;

	type EditAction = "frames" | "interval" | "delete" | "back";
	const items: SelectItem<EditAction>[] = [
		{ value: "frames", label: "Frames", description: `${current.frames.length} frames` },
		{ value: "interval", label: "Interval", description: `${current.intervalMs}ms` },
		{ value: "delete", label: "Delete", description: "remove this custom" },
		{ value: "back", label: "Back", description: "return to main menu" },
	];

	const result = await ctx.ui.custom<EditAction>((tui, theme, _kb, done) =>
		buildSelectScreen<EditAction>(
			{
				title: `Edit ${current.name}`,
				items,
				hint: "enter to apply · esc back",
				cancelValue: "back",
			},
			tui,
			theme,
			done,
		),
	);

	if (!result || result === "back") return;

	if (result === "delete") {
		const confirmed = await ctx.ui.confirm(
			"Delete custom animation?",
			`Remove "${current.name}" from the registry. The active animation falls back to braille if this one is selected.`,
		);
		if (!confirmed) return;
		const next = deleteCustom(state, current.name);
		state.preset = next.preset;
		state.customs = next.customs;
		applyPreview(state, cycler, ctx);
		ctx.ui.notify(`Deleted ${current.name}`, "info");
		return;
	}

	if (result === "frames") {
		const edited = await ctx.ui.editor("Custom frames (one per line)", current.frames.join("\n"));
		if (edited === undefined) return;
		const frames = parseFrameList(edited);
		if (frames.length === 0) {
			ctx.ui.notify("Need at least one frame", "error");
			return;
		}
		state.customs = upsertCustom(state.customs, { ...current, frames });
		applyPreview(state, cycler, ctx);
		ctx.ui.notify(`Frames updated: ${frames.length}`, "info");
		return;
	}

	const intervalMs = await promptFrameInterval(ctx, current.intervalMs);
	if (intervalMs === undefined) return;
	state.customs = upsertCustom(state.customs, { ...current, intervalMs });
	applyPreview(state, cycler, ctx);
	ctx.ui.notify(`Frame interval: ${intervalMs}ms`, "info");
}

async function promptFrameInterval(ctx: ExtensionContext, current: number): Promise<number | undefined> {
	const raw = await ctx.ui.input("Frame interval (milliseconds)", String(current));
	if (raw === undefined) return undefined;

	const ms = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(ms) || ms <= 0) {
		ctx.ui.notify("Invalid number", "error");
		return undefined;
	}

	if (ms < LIMITS.MIN_FRAME_INTERVAL_MS || ms > LIMITS.MAX_FRAME_INTERVAL_MS) {
		ctx.ui.notify(
			`Must be between ${LIMITS.MIN_FRAME_INTERVAL_MS}ms and ${LIMITS.MAX_FRAME_INTERVAL_MS}ms`,
			"error",
		);
		return undefined;
	}

	return ms;
}

async function editMessages(state: SpinnerConfig, cycler: MessageCycler | null, ctx: ExtensionContext): Promise<void> {
	const prefill = state.messages.join("\n");
	const edited = await ctx.ui.editor("Edit messages (one per line)", prefill);
	if (edited === undefined) return;

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
						`  animation: ${resolveAnimation(state).label}`,
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
			const partial: UserSpinnerConfig = {
				preset: state.preset,
				customs: state.customs,
				messages: state.messages,
				messagePack: state.messagePack,
				cycleIntervalMs: state.cycleIntervalMs,
				cycleMode: state.cycleMode,
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

	const d = defaults();
	state.preset = d.preset;
	state.customs = [...d.customs];
	state.messages = [...d.messages];
	state.messagePack = d.messagePack;
	state.cycleIntervalMs = d.cycleIntervalMs;
	state.cycleMode = d.cycleMode;
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
	ctx.ui.setWorkingIndicator(buildIndicator(state, ctx.ui.theme));
	if (cycler) {
		cycler.update(state.messages, state.cycleIntervalMs, state.cycleMode);
		if (cycler.isRunning) cycler.tickNow();
	}
}
