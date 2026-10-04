/**
 * /preview [path] - render a markdown file with Pi's own renderer in a scrollable overlay.
 * Overlay content never enters model context.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Markdown, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { applyScrollAction, clampScrollOffset, scrollActionForInput as scrollActionForInputRaw } from "./context-scroll.mjs";
import { readPreviewFile, resolvePreviewTarget } from "./preview-helpers.mjs";

function scrollActionForInput(data: string, pageSize: number) {
	return scrollActionForInputRaw(data, pageSize, matchesKey);
}

function terminalRows(tui: any): number {
	const fromTui = tui?.terminal?.rows;
	if (typeof fromTui === "number" && fromTui > 0) return fromTui;
	const fromStdout = process.stdout?.rows;
	if (typeof fromStdout === "number" && fromStdout > 0) return fromStdout;
	return 24;
}

/** Full-screen custom UI options so sticky/scroll extensions do not steal keys. */
const SCROLLABLE_OVERLAY_OPTIONS = {
	overlay: true as const,
	overlayOptions: {
		anchor: "top-left" as const,
		width: "100%" as const,
		maxHeight: "100%" as const,
		margin: 0,
	},
};

type PreviewOverlayOptions = {
	content: string;
	displayPath: string;
	reload: () => string;
	rows: number;
	theme: any;
	onClose: () => void;
};

class PreviewOverlay implements Component {
	private markdown: Markdown;
	private displayPath: string;
	private reload: () => string;
	private rows: number;
	private theme: any;
	private onClose: () => void;
	private cachedLines: string[] = [];
	private cachedWidth = -1;
	private offset = 0;

	constructor(options: PreviewOverlayOptions) {
		this.markdown = new Markdown(options.content, 0, 0, getMarkdownTheme());
		this.displayPath = options.displayPath;
		this.reload = options.reload;
		this.rows = options.rows;
		this.theme = options.theme;
		this.onClose = options.onClose;
	}

	render(width: number): string[] {
		if (width !== this.cachedWidth || this.cachedLines.length === 0) {
			this.cachedLines = this.markdown.render(width);
			this.cachedWidth = width;
		}
		const viewportLines = Math.max(1, this.rows - 1);
		this.offset = clampScrollOffset(this.offset, this.cachedLines.length, viewportLines);
		const header = truncateToWidth(
			this.theme.fg("dim", `${this.displayPath} · ${this.cachedLines.length} lines · ↑↓ scroll · r reload · esc/q close`),
			width,
		);
		const visible = this.cachedLines
			.slice(this.offset, this.offset + viewportLines)
			.map((line) => truncateToWidth(line, width));
		return [header, ...visible];
	}

	handleInput(data: string): boolean {
		const viewportLines = Math.max(1, this.rows - 1);
		const action = scrollActionForInput(data, viewportLines);
		if (action) {
			this.offset = applyScrollAction(action, this.offset, this.cachedLines.length, viewportLines);
			return true;
		}
		if (data === "g" || matchesKey(data, "home")) {
			this.offset = 0;
			return true;
		}
		if (data === "G" || matchesKey(data, "end")) {
			this.offset = Math.max(0, this.cachedLines.length - viewportLines);
			return true;
		}
		if (data === "r") {
			this.markdown.setText(this.reload());
			this.offset = 0;
			this.cachedLines = [];
			this.cachedWidth = -1;
			return true;
		}
		if (matchesKey(data, "escape") || data === "q") {
			this.onClose();
			return true;
		}
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("preview", {
		description: "Preview a markdown file in an overlay",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/preview requires TUI mode", "error");
				return;
			}
			const resolved = resolvePreviewTarget(args ?? "", ctx.cwd);
			if (!resolved.ok) {
				ctx.ui.notify(resolved.error, "error");
				return;
			}
			const loaded = readPreviewFile(resolved.absolutePath);
			if (!loaded.ok) {
				ctx.ui.notify(loaded.error, "error");
				return;
			}
			await ctx.ui.custom(
				(tui, theme, _keybindings, done) =>
					new PreviewOverlay({
						content: loaded.content,
						displayPath: resolved.displayPath,
						reload: () => {
							const r = readPreviewFile(resolved.absolutePath);
							return r.ok ? r.content : `reload failed: ${r.error}`;
						},
						rows: terminalRows(tui),
						theme,
						onClose: () => done(undefined),
					}),
				SCROLLABLE_OVERLAY_OPTIONS,
			);
		},
	});
}
