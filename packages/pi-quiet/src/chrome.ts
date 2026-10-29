import { homedir } from "node:os";
import {
	CustomEditor,
	keyText,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	truncateToWidth,
	visibleWidth,
	type EditorTheme,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { compactLocation, label, workspaceName } from "./format.ts";
import { quietTheme } from "./theme.ts";

function frame(
	left: string,
	right: string,
	width: number,
	theme: Theme
): string {
	if (width < 2) return theme.fg("border", "─".repeat(Math.max(0, width)));
	const content = truncateToWidth(right, Math.max(0, width - 4), "");
	return (
		theme.fg(
			"border",
			left + "─".repeat(Math.max(0, width - visibleWidth(content) - 2))
		) +
		content +
		theme.fg("border", "╯")
	);
}

/** Keep native editing, paste, autocomplete, IME markers, and application shortcuts. */
export class QuietEditor extends CustomEditor {
	private bottomLine = "";
	private hiddenTop = 0;
	private hiddenBottom = 0;
	private currentTheme: () => Theme;
	private info: () => string;
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		currentTheme: () => Theme,
		info: () => string
	) {
		super(tui, theme, keybindings, {
			paddingX: 0,
			embedWorkingStatus: false,
		});
		this.currentTheme = currentTheme;
		this.info = info;
	}
	protected renderTopBorder(width: number, hidden: number): string {
		const theme = this.currentTheme();
		this.hiddenTop = hidden;
		const note = truncateToWidth(
			hidden ? ` ↑ ${hidden} more ` : "",
			Math.max(0, width - 2),
			""
		);
		return theme.fg(
			"border",
			`╭${"─".repeat(
				Math.max(0, width - visibleWidth(note) - 2)
			)}${note}╮`
		);
	}
	protected renderBottomBorder(width: number, hidden: number): string {
		const theme = this.currentTheme();
		this.hiddenBottom = hidden;
		this.bottomLine = frame(
			"╰",
			theme.fg(
				"muted",
				` ${hidden ? `↓ ${hidden} more · ` : ""}${this.info()} `
			),
			width,
			theme
		);
		return this.bottomLine;
	}
	render(width: number): string[] {
		// Native wrapping cannot place a wide grapheme in one column; lay out safely, then clip.
		if (width < 12)
			return super.render(Math.max(4, width)).map((line) => {
				const clipped = truncateToWidth(line, width);
				return line.includes(CURSOR_MARKER) &&
					!clipped.includes(CURSOR_MARKER)
					? CURSOR_MARKER + clipped
					: clipped;
			});
		// The protected border hooks identify the body end without touching Editor's private layout state.
		const lines = super.render(width - 6);
		const bottom = lines.indexOf(this.bottomLine, 1);
		const theme = this.currentTheme();
		return lines.map((line, i) => {
			if (i === 0) return this.renderTopBorder(width, this.hiddenTop);
			if (i === bottom)
				return this.renderBottomBorder(width, this.hiddenBottom);
			if (i > bottom) return truncateToWidth(`    ${line}`, width);
			return (
				theme.fg("border", "│ ") +
				(i === 1 ? theme.fg("accent", "❯ ") : "  ") +
				line +
				theme.fg("border", " │")
			);
		});
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.width < 12)
			return super.handleMouse({
				...event,
				width: Math.max(4, event.width),
			});
		return super.handleMouse({
			...event,
			x: Math.max(0, event.x - 4),
			width: event.width - 6,
		});
	}
}

export function welcomeLines(
	width: number,
	theme: Theme,
	cwd: string,
	model: string
): string[] {
	const title = theme.bold("Pi Quiet");
	const content = [
		title,
		theme.fg("muted", "A quieter place to build."),
		theme.fg("dim", "/resume sessions · /new start fresh"),
		theme.fg("muted", workspaceName(cwd)),
		theme.fg("dim", label(model)),
	];
	if (width < 68)
		return ["", ...content, ""].map((line) => truncateToWidth(line, width));
	const art = [
		"  ▄▄▄▄▄▄▄▄▄▄▄  ",
		"    ██   ██    ",
		"    ██   ██    ",
		"    ██   ██    ",
		"    ██   ▀██▄  ",
	];
	const boxWidth = Math.min(width, 100);
	const inner = boxWidth - 4;
	const border = (s: string) => theme.fg("border", s);
	const blank = border("│") + " ".repeat(boxWidth - 2) + border("│");
	return [
		"",
		border(`╭${"─".repeat(boxWidth - 2)}╮`),
		blank,
		...content.map((line, i) => {
			const text = `${theme.fg("accent", art[i]!)}   ${line}`;
			const fit = truncateToWidth(text, inner);
			return (
				border("│ ") +
				fit +
				" ".repeat(Math.max(0, inner - visibleWidth(fit))) +
				border(" │")
			);
		}),
		blank,
		border(`╰${"─".repeat(boxWidth - 2)}╯`),
		"",
	].map((line) => " ".repeat(Math.floor((width - boxWidth) / 2)) + line);
}

export class QuietChrome {
	private restoreCurrent?: () => void;
	private redraw?: () => void;

	private pi: ExtensionAPI;
	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}
	refresh(): void {
		this.redraw?.();
	}
	restore(): void {
		this.restoreCurrent?.();
		this.restoreCurrent = undefined;
		this.redraw = undefined;
	}

	install(ctx: ExtensionContext): void {
		this.restore();
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui;
		const previousTheme = ui.theme;
		const previousEditor = ui.getEditorComponent();
		const theme = quietTheme(previousTheme);
		ui.setTheme(theme);
		ui.setHiddenThinkingLabel("Thinking");
		ui.setWorkingMessage("Working");
		ui.setWorkingIndicator({
			frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
			intervalMs: 100,
		});
		ui.setHeader((tui) => {
			this.redraw = () => tui.requestRender();
			return {
				invalidate() {},
				render: (width) => {
					const hasMessages = ctx.sessionManager
						.getBranch()
						.some(
							(entry) =>
								entry.type === "message" &&
								entry.message.role === "user"
						);
					const location = ui.theme.fg(
						"dim",
						compactLocation(ctx.cwd, homedir())
					);
					return hasMessages
						? [truncateToWidth(location, width)]
						: [
								truncateToWidth(location, width),
								...welcomeLines(
									width,
									ui.theme,
									ctx.cwd,
									ctx.model?.name ??
										"Choose a model with /model"
								),
						  ];
				},
			};
		});
		ui.setEditorComponent(
			(tui, editorTheme, bindings) =>
				new QuietEditor(
					tui,
					editorTheme,
					bindings,
					() => ui.theme,
					() => {
						const level = this.pi.getThinkingLevel();
						return `${label(ctx.model?.name ?? "No model", 80)}${
							level !== "off" ? ` (${level})` : ""
						}`;
					}
				)
		);
		ui.setFooter((tui, _theme, data) => {
			const unsubscribe = data.onBranchChange(() => tui.requestRender());
			return {
				invalidate() {},
				dispose: unsubscribe,
				render: (width) => {
					const theme = ui.theme;
					const branch = label(data.getGitBranch() ?? "", 80);
					const usage = ctx.getContextUsage();
					const context =
						usage?.percent == null
							? ""
							: `${Math.round(usage.percent)}% context`;
					const left = [branch ? `⑂ ${branch}` : "", context]
						.filter(Boolean)
						.join(" · ");
					const hints = ctx.isIdle()
						? `${keyText("app.tools.expand")} expand · ${keyText(
								"app.model.select"
						  )} model · /help`
						: `${keyText("app.interrupt")} interrupt · ${keyText(
								"app.message.followUp"
						  )} queue`;
					const right = theme.fg("dim", hints);
					const gap =
						width - visibleWidth(left) - visibleWidth(right);
					const line =
						gap > 2
							? theme.fg("muted", left) + " ".repeat(gap) + right
							: right;
					const statuses = [...data.getExtensionStatuses().values()]
						.filter(Boolean)
						.join("  ");
					return [
						truncateToWidth(line, width),
						...(statuses ? [truncateToWidth(statuses, width)] : []),
					];
				},
			};
		});
		this.restoreCurrent = () => {
			ui.setHeader(undefined);
			ui.setFooter(undefined);
			ui.setEditorComponent(previousEditor);
			ui.setHiddenThinkingLabel();
			ui.setWorkingMessage();
			ui.setWorkingIndicator();
			if (ui.theme.name === "pi-quiet") ui.setTheme(previousTheme);
		};
	}
}
