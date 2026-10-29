import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { QuietChrome, QuietEditor, welcomeLines } from "./chrome.ts";
import { quietTheme } from "./theme.ts";

function bindings(): any {
	return new KeybindingsManager({
		...TUI_KEYBINDINGS,
		"app.interrupt": { defaultKeys: "escape", description: "Interrupt" },
	});
}

function palette(appearance: "light" | "dark" = "dark") {
	return quietTheme({ appearance, getColorMode: () => "truecolor" } as any);
}

test("welcome and editor fit narrow widths, Unicode, long names, wrapped drafts and IME markers", () => {
	const theme = palette();
	const tui = { terminal: { rows: 36 }, requestRender() {} } as any;
	const editor = new QuietEditor(
		tui,
		{ borderColor: (s) => s, selectList: {} } as any,
		bindings(),
		() => theme,
		() => "Model (high)"
	);
	editor.focused = true;
	for (const text of [
		"",
		"hello",
		"日本語 👩🏽‍💻 é ".repeat(20),
		Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n"),
	]) {
		editor.setText(text);
		for (const width of [1, 8, 11, 12, 20, 40, 80, 120]) {
			const lines = editor.render(width);
			for (const line of lines)
				assert.ok(
					visibleWidth(line) <= width,
					`width=${width} actual=${visibleWidth(
						line
					)} ${stripVTControlCharacters(line)}`
				);
			assert.ok(
				lines.some((line) => line.includes(CURSOR_MARKER)),
				`missing IME cursor at ${width}`
			);
		}
	}
	for (const width of [1, 20, 67, 68, 80, 120]) {
		for (const line of welcomeLines(
			width,
			theme,
			"/repo/日本語",
			"Model".repeat(30)
		))
			assert.ok(visibleWidth(line) <= width);
	}
});

test("editor forwards native send, newline, application shortcuts and history", () => {
	const theme = palette();
	const editor = new QuietEditor(
		{ terminal: { rows: 30 }, requestRender() {} } as any,
		{ borderColor: (s) => s, selectList: {} } as any,
		bindings(),
		() => theme,
		() => "Model"
	);
	let submitted = "";
	editor.onSubmit = (text) => {
		submitted = text;
	};
	editor.handleInput("hello");
	editor.handleInput("\r");
	assert.equal(submitted, "hello");
	let interrupted = false;
	editor.onEscape = () => {
		interrupted = true;
	};
	editor.handleInput("\x1b");
	assert.equal(interrupted, true);
	editor.setText("日本語");
	editor.handleInput("\x1b[13;2u");
	assert.match(editor.getText(), /\n/);
});

test("chrome is TUI-only, restores native chrome/editor/theme and leaves deliberate theme changes alone", () => {
	const previous = palette("light");
	const previousEditor = () => ({});
	let currentTheme = previous;
	let editor: any = previousEditor;
	const calls: string[] = [];
	const ui: any = {
		get theme() {
			return currentTheme;
		},
		getEditorComponent: () => editor,
		setEditorComponent: (factory) => {
			editor = factory;
		},
		setTheme: (theme) => {
			assert.equal(typeof theme, "object");
			currentTheme = theme;
			return { success: true };
		},
		setHeader: () => calls.push("header"),
		setFooter: () => calls.push("footer"),
		setHiddenThinkingLabel() {},
		setWorkingMessage() {},
		setWorkingIndicator() {},
	};
	const chrome = new QuietChrome({ getThinkingLevel: () => "off" } as any);
	chrome.install({ mode: "rpc", ui } as any);
	assert.deepEqual(calls, []);
	chrome.install({ mode: "tui", ui } as any);
	assert.equal(currentTheme.name, "pi-quiet");
	assert.equal(currentTheme.appearance, "light");
	chrome.restore();
	assert.equal(currentTheme, previous);
	assert.equal(editor, previousEditor);
	chrome.install({ mode: "tui", ui } as any);
	const chosen = new Theme(
		{ muted: "#999", text: "#fff", thinkingXhigh: "#abc" } as any,
		{ selectedBg: "#000" } as any,
		"truecolor",
		{ name: "chosen" }
	);
	currentTheme = chosen;
	chrome.restore();
	assert.equal(currentTheme, chosen);
});
