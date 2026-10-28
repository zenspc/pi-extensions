/** Full-screen scrollable overlay for the report. Its content never enters the model context. */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, type KeyId } from "@earendil-works/pi-tui";
import { renderReport, type Palette } from "./render.ts";
import type { Report } from "./report.ts";

function themePalette(theme: Theme): Palette {
	return {
		title: (t) => theme.bold(theme.fg("accent", t)),
		heading: (t) => theme.bold(theme.fg("mdHeading", t)),
		dim: (t) => theme.fg("dim", t),
		setup: (t) => theme.fg("accent", t),
		conversation: (t) => theme.fg("success", t),
		warn: (t) => theme.fg("warning", t),
	};
}

const SCROLL_KEYS: ReadonlyArray<{ keys: readonly KeyId[]; move: (offset: number, page: number, max: number) => number }> = [
	{ keys: ["up", "k"], move: (o) => o - 1 },
	{ keys: ["down", "j"], move: (o) => o + 1 },
	{ keys: ["pageUp", "b"], move: (o, page) => o - page },
	{ keys: ["pageDown", "space", "f"], move: (o, page) => o + page },
	{ keys: ["home", "g"], move: () => 0 },
	{ keys: ["end", "shift+g"], move: (_o, _page, max) => max },
];

export async function showReport(ctx: ExtensionCommandContext, report: Report): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const palette = themePalette(theme);
			let offset = 0;
			let page = 1;
			let cachedWidth = -1;
			let cachedLines: string[] = [];

			const bodyFor = (width: number): string[] => {
				if (width !== cachedWidth) {
					cachedLines = renderReport(report, palette, width).map((line) => truncateToWidth(line, width, "…", true));
					cachedWidth = width;
				}
				return cachedLines;
			};
			const maxOffset = () => Math.max(0, cachedLines.length - page);

			return {
				render(width: number): string[] {
					const body = bodyFor(width);
					page = Math.max(1, tui.terminal.rows - 2);
					offset = Math.min(Math.max(0, offset), maxOffset());
					const visible = body.slice(offset, offset + page);
					while (visible.length < page) visible.push(" ".repeat(width));
					const range = `${Math.min(body.length, offset + 1)}-${Math.min(body.length, offset + page)}/${body.length}`;
					const hint = theme.fg("dim", `${range} · ↑↓ jk scroll · PgUp/PgDn · g/G · q close`);
					return [...visible, truncateToWidth(hint, width, "…", true)];
				},
				invalidate() {
					cachedWidth = -1;
				},
				handleInput(data: string) {
					if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "q")) {
						done();
						return;
					}
					const scroll = SCROLL_KEYS.find(({ keys }) => keys.some((key) => matchesKey(data, key)));
					if (!scroll) return;
					offset = Math.min(Math.max(0, scroll.move(offset, Math.max(1, page - 1), maxOffset())), maxOffset());
					tui.requestRender();
				},
			};
		},
		{ overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } },
	);
}
