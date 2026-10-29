import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderWelcome } from "../../extensions/welcome-header.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	getColorMode: () => "truecolor",
} as unknown as Theme;

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
