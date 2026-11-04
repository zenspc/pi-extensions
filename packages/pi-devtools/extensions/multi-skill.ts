import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

function inlineSkillPrefix(lines: string[], line: number, col: number): string | undefined {
	const beforeCursor = (lines[line] ?? "").slice(0, col);
	const prefix = beforeCursor.match(/(?:^|\s)(\/(?:skill:)?[a-z0-9-]*)$/)?.[1];
	if (!prefix || (line === 0 && beforeCursor.trim() === prefix)) return undefined;
	const text = [...lines.slice(0, line), beforeCursor].join("\n");
	const start = text.length - prefix.length;
	for (const code of text.matchAll(/(`+|~{3,})[\s\S]*?(?:\1|$)/g)) {
		if (code.index + code[0].length > start) return undefined;
	}
	return prefix;
}

function skillAutocomplete(current: AutocompleteProvider, getCommands: () => SlashCommandInfo[]): AutocompleteProvider {
	return {
		triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "/"])],
		async getSuggestions(lines, line, col, options) {
			const prefix = inlineSkillPrefix(lines, line, col);
			if (prefix === undefined || options.signal.aborted) return current.getSuggestions(lines, line, col, options);
			const query = prefix.slice(1).replace(/^skill:/, "");
			const items = getCommands()
				.filter((command) => command.source === "skill" && command.name.slice(6).startsWith(query))
				.map((command) => ({ value: `/${command.name}`, label: `/${command.name}`, description: command.description }));
			return items.length > 0 ? { prefix, items } : current.getSuggestions(lines, line, col, options);
		},
		applyCompletion(lines, line, col, item, prefix) {
			if (inlineSkillPrefix(lines, line, col) !== prefix || !item.value.startsWith("/skill:")) {
				return current.applyCompletion(lines, line, col, item, prefix);
			}
			const currentLine = lines[line] ?? "";
			const before = currentLine.slice(0, col - prefix.length);
			const after = currentLine.slice(col);
			const suffix = /^\s/.test(after) ? "" : " ";
			const result = [...lines];
			result[line] = `${before}${item.value}${suffix}${after}`;
			return { lines: result, cursorLine: line, cursorCol: before.length + item.value.length + suffix.length };
		},
		shouldTriggerFileCompletion(lines, line, col) {
			return inlineSkillPrefix(lines, line, col) === undefined
				? (current.shouldTriggerFileCompletion?.(lines, line, col) ?? true)
				: false;
		},
	};
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function expandSkillReferences(text: string, commands: SlashCommandInfo[]): Promise<string | undefined> {
	const skills = new Map(commands.filter((command) => command.source === "skill").map((command) => [command.name, command]));
	const reserved = new Set(commands.filter((command) => command.source !== "skill").map((command) => command.name));
	const leadingCommand = text.match(/^\/([^\s]+)/)?.[1];
	if (leadingCommand && reserved.has(leadingCommand)) return undefined;
	const selected = new Map<string, SlashCommandInfo>();
	// Consume code spans/fences before looking for standalone slash references.
	const references = /(`+|~{3,})[\s\S]*?\1|(?:^|\s)\/((?:skill:)?[a-z0-9][a-z0-9-]*)(?=$|[\s.,!?;:)])/g;
	for (const match of text.matchAll(references)) {
		const name = match[2];
		if (!name || reserved.has(name)) continue;
		const command = skills.get(name.startsWith("skill:") ? name : `skill:${name}`);
		if (command) selected.set(command.name, command);
	}
	if (selected.size === 0) return undefined;

	const blocks: string[] = [];
	for (const command of selected.values()) {
		const path = command.sourceInfo.path;
		let content: string;
		try {
			content = await readFile(path, "utf8");
		} catch (error) {
			throw new Error(`Cannot load /${command.name} from ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
		blocks.push(`<skill name="${escapeAttribute(command.name.slice(6))}" location="${escapeAttribute(path)}">\nReferences are relative to ${dirname(path)}.\n\n${stripFrontmatter(content).trim()}\n</skill>`);
	}
	return `${blocks.join("\n\n")}\n\n${text}`;
}

export default function multiSkill(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.addAutocompleteProvider((current) => skillAutocomplete(current, () => pi.getCommands()));
	});
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		try {
			const text = await expandSkillReferences(event.text, pi.getCommands());
			return text === undefined ? { action: "continue" } : { action: "transform", text };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else pi.sendMessage({ customType: "multi-skill-error", content: message, display: true });
			if (event.source === "interactive") ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}
	});
}
