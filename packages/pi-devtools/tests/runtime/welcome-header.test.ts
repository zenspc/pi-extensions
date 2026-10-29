import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, visibleWidth } from "@earendil-works/pi-tui";
import welcomeExtension, { renderWelcome, type WelcomeResources } from "../../extensions/welcome-header.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	getColorMode: () => "truecolor",
} as unknown as Theme;

const resources: WelcomeResources = {
	context: ["AGENTS.md", "CONTEXT.md", "APPEND_SYSTEM.md", "project/AGENTS.md"],
	skills: Array.from({ length: 100 }, (_, i) => `skill-${i}`),
	prompts: Array.from({ length: 20 }, (_, i) => `prompt-${i}`),
	extensions: ["welcome-header", ...Array.from({ length: 100 }, (_, i) => `extension-${i}`)],
	themes: ["dark", "light", "dracula"],
};

describe("welcome resource bounds", () => {
	it("fits large resource lists into the available height at narrow and wide widths", () => {
		for (const width of [30, 46, 80, 120]) {
			for (const maxHeight of [4, 8, 12, 20, 30]) {
				const lines = renderWelcome({ width, theme, resources, maxHeight });
				assert.ok(lines.length <= maxHeight, `${width} columns: ${lines.length} > ${maxHeight}`);
				assert.ok(lines.every((line) => visibleWidth(line) <= width));
				assert.ok(lines.join("\n").includes("ctrl+o"));
			}
		}
	});

	it("handles tiny terminals without exceeding either dimension", () => {
		for (const width of [0, 1, 2, 8, 20]) {
			for (const maxHeight of [0, 1, 2, 3, 5]) {
				const lines = renderWelcome({ width, theme, resources, maxHeight });
				assert.ok(lines.length <= maxHeight);
				assert.ok(lines.every((line) => visibleWidth(line) <= width));
			}
		}
	});

	it("keeps full lists opt-in via expansion", () => {
		const collapsed = renderWelcome({ width: 100, theme, resources, maxHeight: 24 }).join("\n");
		assert.ok(collapsed.includes("more"));
		assert.ok(!collapsed.includes("skill-99"));
		const roomy = renderWelcome({ width: 100, theme, resources, maxHeight: 40 }).join("\n");
		assert.ok(roomy.includes("skill-0"));
		assert.ok(roomy.includes("+97 more"));
		assert.ok(roomy.includes("+98 more"));
		const expanded = renderWelcome({ width: 100, theme, resources, maxHeight: 24, expanded: true }).join("\n");
		assert.ok(expanded.includes("skill-99"));
		assert.ok(expanded.includes("extension-99"));
		assert.ok(expanded.includes("show less"));
	});

	it("captures current Pi resource components and leaves no duplicate stock lists", async (t) => {
		// Pi 1.4 uses theme-aware ExpandableText without getCollapsedText().
		class ResourceText extends Text {
			expanded = false;
			title: string;
			items: string[];
			constructor(title: string, items: string[]) {
				super("", 0, 0);
				this.title = title;
				this.items = items;
			}
			build = () => `[${this.title}]\n${this.items.join(this.expanded ? "\n" : ", ")}`;
			setExpanded(value: boolean) { this.expanded = value; this.invalidate(); }
			render(width: number) { this.setText(this.build()); return super.render(width); }
		}
		const header = new Container();
		const panel = new Container();
		for (const [name, items] of Object.entries(resources)) {
			panel.addChild(new ResourceText(name[0].toUpperCase() + name.slice(1), items));
			panel.addChild(new Spacer(1));
		}
		const warning = new Text("[Extension issues]\nkeep this warning", 0, 0);
		panel.addChild(warning);
		const document = new Container();
		document.addChild(header);
		document.addChild(panel);
		document.addChild(new Container());
		const dock = new Text("editor\nfooter", 0, 0);
		const tui = { children: [document, dock], terminal: { rows: 24, columns: 100 }, requestRender() {} };
		let start: Function = () => {};
		let component: any;
		welcomeExtension({ on(_name: string, handler: Function) { start = handler; } } as any);
		await start({}, { mode: "tui", ui: { setHeader(factory: Function) {
			component = factory(tui, theme);
			header.addChild(component);
		} } });
		t.after(() => component.dispose());
		component.render(100);
		assert.deepEqual(panel.children, [warning]);
		assert.ok(component.render(100).join("\n").includes("more"));
		assert.ok(document.render(100).length + dock.render(100).length <= tui.terminal.rows);
		tui.terminal.rows = 16;
		assert.ok(document.render(100).length + dock.render(100).length <= 16);
		component.setExpanded(true);
		assert.ok(component.render(100).join("\n").includes("skill-99"));
		component.setExpanded(false);
		assert.ok(document.render(100).length + dock.render(100).length <= 16);
		// The host can rebuild resources after startup or reload.
		panel.clear();
		panel.addChild(new ResourceText("Skills", ["late-skill", ...resources.skills]));
		panel.addChild(warning);
		component.render(100);
		assert.deepEqual(panel.children, [warning]);
		component.setExpanded(true);
		assert.ok(component.render(100).join("\n").includes("late-skill"));
		component.dispose();
		assert.ok(panel.children.some((child) => child instanceof ResourceText));
	});
});

describe("welcome header logo", () => {
	it("renders the default Pi design at 20 columns by 10 lines in brand colors", () => {
		const lines = renderWelcome({ width: 100, theme });
		const plain = lines.map(stripVTControlCharacters);
		assert.ok(plain[1].startsWith(" " + "▀".repeat(15) + " ".repeat(5)));
		assert.ok(plain[10].startsWith(" " + "▀".repeat(5) + " ".repeat(10) + "▀".repeat(5)));
		assert.ok(lines[1].includes("\x1b[38;2;228;138;122m"));
		assert.ok(lines[3].includes("\x1b[48;2;79;142;179m"));
		assert.ok(lines[6].includes("\x1b[38;2;234;182;93m"));
	});

	it("uses a 12-column, 6-line logo on narrower terminals", () => {
		const lines = renderWelcome({ width: 46, theme }).map(stripVTControlCharacters);
		assert.ok(lines[1].startsWith(" " + "▀".repeat(9) + " ".repeat(3)));
		assert.ok(lines[6].startsWith(" " + "▀".repeat(3) + " ".repeat(6) + "▀".repeat(3)));
		assert.ok(lines[1].includes("pi"));
	});

	it("keeps the header within the available width", () => {
		for (const width of [0, 1, 4, 12, 30, 40, 80, 120]) {
			const lines = renderWelcome({ width, theme, modelLabel: "provider/model" });
			assert.ok(lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
		}
	});

	it("uses the colored wordmark in Apple Terminal", (t) => {
		t.mock.property(process, "platform", "darwin");
		t.mock.property(process, "env", { ...process.env, TERM_PROGRAM: "Apple_Terminal" });
		const lines = renderWelcome({ width: 100, theme });
		assert.ok(stripVTControlCharacters(lines[1]).startsWith(" Pi"));
		assert.ok(!lines.some((line) => stripVTControlCharacters(line).includes("▀")));
	});
});
