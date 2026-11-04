import {
	copyToClipboard,
	getMarkdownTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Input,
	Markdown,
	Text,
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui";
import { SideThread } from "./thread.ts";

export class SidePanel implements Component, Focusable {
	private selected: number;
	private scroll = 0;
	private bodyHeight = 1;
	private bodyLines = 0;
	private notice = "";
	private markdown = new Markdown("", 0, 0, getMarkdownTheme());
	private readonly input = new Input({
		placeholder: "Type a side question...",
	});

	private readonly options: {
		thread: SideThread;
		tui: TUI;
		theme: Theme;
		keys: KeybindingsManager;
		ask: (question: string) => Promise<void>;
		done: () => void;
	};

	constructor(options: SidePanel["options"]) {
		this.options = options;
		this.selected = options.thread.exchanges.length - 1;
		this.input.onSubmit = (value) => this.submit(value);
	}

	get focused() {
		return this.input.focused;
	}
	set focused(value: boolean) {
		this.input.focused = value;
	}

	private submit(value: string) {
		const question = stripTerminalSequences(value).trim();
		if (!question) return;
		if (this.thread.running) {
			this.notice =
				"Draft kept. Press Enter to send after the current answer finishes.";
			return;
		}
		try {
			void this.options.ask(question);
			this.selected = this.thread.exchanges.length - 1;
			this.scroll = 0;
			this.notice = "";
			this.input.setValue("");
		} catch (error) {
			this.notice = stripTerminalSequences(
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	private get thread() {
		return this.options.thread;
	}
	private get tui() {
		return this.options.tui;
	}
	private get theme() {
		return this.options.theme;
	}
	private get keys() {
		return this.options.keys;
	}
	private get done() {
		return this.options.done;
	}

	refresh() {
		this.tui.requestRender();
	}
	invalidate() {
		this.markdown = new Markdown("", 0, 0, getMarkdownTheme());
		this.input.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const height = Math.max(
			7,
			Math.min(16, Math.floor(this.tui.terminal.rows / 2))
		);
		const exchange = this.thread.exchanges[this.selected];
		const clean = (text: string) => stripTerminalSequences(text);
		const lines = [
			this.theme.fg(
				"accent",
				` /btw  |  tools off  |  ${Math.min(
					this.selected + 1,
					this.thread.exchanges.length
				)}/${this.thread.exchanges.length}`
			),
		];
		const previous = this.thread.exchanges.slice(0, this.selected);
		const recentCount = Math.min(5, Math.max(0, height - 12));
		if (previous.length > recentCount && recentCount)
			lines.push(
				this.theme.fg(
					"dim",
					` ${previous.length - recentCount} older side questions`
				)
			);
		for (const item of recentCount ? previous.slice(-recentCount) : [])
			lines.push(
				this.theme.fg(
					"dim",
					truncateToWidth(
						` ${clean(item.question).replaceAll("\n", " ")}`,
						inner
					)
				)
			);
		if (exchange) {
			lines.push(
				...new Text(clean(exchange.question), 0, 0)
					.render(inner)
					.slice(0, Math.max(1, Math.min(3, height - 8)))
					.map((line) => this.theme.fg("accent", line))
			);
			const label =
				exchange.state === "streaming"
					? "Answering independently..."
					: exchange.state === "error"
					? "Side question failed"
					: "";
			this.markdown.setText(clean(exchange.answer || label));
			const body = this.markdown.render(inner);
			if (exchange.answer && label)
				body.push(this.theme.fg("dim", label));
			this.bodyHeight = Math.max(1, height - lines.length - 4);
			this.bodyLines = body.length;
			this.scroll = Math.min(
				this.scroll,
				Math.max(0, body.length - this.bodyHeight)
			);
			lines.push(
				...body.slice(this.scroll, this.scroll + this.bodyHeight)
			);
		} else
			lines.push(
				"Ask a side question below. The main agent keeps working."
			);
		lines.push(...this.input.render(inner));
		lines.push(
			this.theme.fg(
				"dim",
				` ${
					this.notice ||
					"Enter send | Esc return to main | Up/Down scroll | Tab history | Alt+C copy | Alt+X clear"
				}`
			)
		);
		const border = this.theme.fg(
			"border",
			`+${"-".repeat(Math.max(0, width - 2))}+`
		);
		return [
			border,
			...lines.map((line) => {
				const text = truncateToWidth(line, inner);
				return (
					this.theme.fg("border", "| ") +
					text +
					" ".repeat(Math.max(0, inner - visibleWidth(text))) +
					this.theme.fg("border", " |")
				);
			}),
			border,
		].map((line) => truncateToWidth(line, width));
	}

	handleInput(data: string) {
		if (this.keys.matches(data, "tui.select.cancel")) {
			this.done();
			return;
		}
		if (matchesKey(data, "alt+x")) {
			this.thread.clear();
			this.done();
			return;
		}
		if (matchesKey(data, "alt+c")) {
			const answer = this.thread.exchanges[this.selected]?.answer;
			if (answer)
				void copyToClipboard(answer).then(
					() => {
						this.notice = "Answer copied.";
						this.refresh();
					},
					() => {
						this.notice = "Clipboard unavailable.";
						this.refresh();
					}
				);
			return;
		}
		const previous =
			matchesKey(data, "shift+left") || matchesKey(data, "shift+tab");
		const next = matchesKey(data, "shift+right") || matchesKey(data, "tab");
		if (previous || next) {
			this.selected = Math.max(
				0,
				Math.min(
					this.thread.exchanges.length - 1,
					this.selected + (previous ? -1 : 1)
				)
			);
			this.scroll = 0;
			this.notice = "";
		} else if (this.keys.matches(data, "tui.select.up"))
			this.scroll = Math.max(0, this.scroll - 1);
		else if (this.keys.matches(data, "tui.select.down"))
			this.scroll = Math.min(
				Math.max(0, this.bodyLines - this.bodyHeight),
				this.scroll + 1
			);
		else if (matchesKey(data, "pageUp"))
			this.scroll = Math.max(0, this.scroll - this.bodyHeight);
		else if (matchesKey(data, "pageDown"))
			this.scroll = Math.min(
				Math.max(0, this.bodyLines - this.bodyHeight),
				this.scroll + this.bodyHeight
			);
		else {
			this.notice = "";
			this.input.handleInput(data);
			const value = this.input.getValue();
			const clean = stripTerminalSequences(value);
			if (clean !== value) this.input.setValue(clean);
		}
		this.refresh();
	}
}
