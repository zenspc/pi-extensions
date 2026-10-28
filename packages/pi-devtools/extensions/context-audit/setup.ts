/**
 * Fixed overhead: what every request pays before the conversation starts.
 * Splits the rendered system prompt into sections, then attributes the pieces
 * that other things contributed (tool snippets, guidelines, skills, files) back to them.
 */
import { basename, dirname } from "node:path";
import type { SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./snapshot.ts";
import { jsonChars } from "./units.ts";

export type SetupKind = "core" | "tool" | "skill" | "context-file" | "section";

export interface SetupItem {
	kind: SetupKind;
	label: string;
	chars: number;
	/** Package, extension, MCP server, or file that is responsible for the cost. */
	origin: string;
	note?: string;
}

export const PI_ORIGIN = "pi built-in";
const CORE_SECTIONS = new Set(["preamble", "docs", "cwd"]);
const SECTION_OPEN = /^<([a-z][a-z0-9_-]*)>$/;
/** Characters one skill adds beyond its name, description, and path (XML frame and indentation). */
const SKILL_FRAME_CHARS = "  <skill>\n    <name></name>\n    <description></description>\n    <location></location>\n  </skill>\n".length;

interface PromptSection {
	name: string;
	/** Text including the surrounding tags, as the model reads it. */
	text: string;
}

/**
 * Pi renders the prompt as untagged preamble text followed by `<name>…</name>` sections.
 * Jumping past each closing tag keeps nested tags (like `<available_skills>`) inside their parent.
 */
function parseSections(prompt: string): PromptSection[] {
	const lines = prompt.split("\n");
	const sections: PromptSection[] = [];
	const preamble: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const name = SECTION_OPEN.exec(lines[i])?.[1];
		const close = name ? lines.indexOf(`</${name}>`, i + 1) : -1;
		if (name && close > i) {
			sections.push({ name, text: lines.slice(i, close + 1).join("\n") });
			i = close + 1;
		} else {
			preamble.push(lines[i]);
			i++;
		}
	}
	if (preamble.join("").trim()) sections.unshift({ name: "preamble", text: preamble.join("\n") });
	return sections;
}

/**
 * Packages name themselves (`npm:…`, `git:…`). Top-level resources are all tagged `auto`,
 * so they are identified by the directory or file they were loaded from.
 */
function originOf(info: SourceInfo, resource: "extension" | "skill"): string {
	if (info.path.startsWith("builtin:")) return PI_ORIGIN;
	if (info.origin === "package") return info.source;
	if (resource === "skill") {
		return shortPath(basename(info.path) === "SKILL.md" ? dirname(dirname(info.path)) : dirname(info.path));
	}
	return shortPath(/^index\.[jt]s$/.test(basename(info.path)) ? dirname(info.path) : info.path);
}

function toolOrigin(tool: ToolInfo): string {
	return tool.namespace ? `${tool.namespace.name} (tool namespace)` : originOf(tool.sourceInfo, "extension");
}

export function shortPath(file: string): string {
	const home = process.env.HOME;
	return home && file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

export function analyzeSetup(snapshot: Snapshot): SetupItem[] {
	const { options, declaredTools } = snapshot;
	const sections = new Map(parseSections(snapshot.systemPrompt).map((s) => [s.name, s]));
	const items: SetupItem[] = [];
	const take = (name: string) => {
		const section = sections.get(name);
		sections.delete(name);
		return section;
	};
	const remainder = (label: string, section: PromptSection, attributed: number) => {
		const chars = section.text.length - attributed;
		if (chars > 0) items.push({ kind: "core", label, chars, origin: PI_ORIGIN });
	};

	const toolList = take("tools");
	const rules = take("rules");
	let snippetChars = 0;
	let guidelineChars = 0;
	const seenGuidelines = new Set<string>();
	for (const tool of declaredTools) {
		const declaration = tool.name.length + tool.description.length + jsonChars(tool.parameters);
		const snippet = options.toolSnippets?.[tool.name];
		const snippetCost = toolList && snippet ? `- ${tool.name}: ${snippet}\n`.length : 0;
		let guidelineCost = 0;
		for (const raw of rules ? (options.toolGuidelines?.[tool.name] ?? []) : []) {
			const rule = raw.trim();
			if (!rule || seenGuidelines.has(rule)) continue;
			seenGuidelines.add(rule);
			guidelineCost += rule.length + 3;
		}
		snippetChars += snippetCost;
		guidelineChars += guidelineCost;
		items.push({
			kind: "tool",
			label: tool.name,
			chars: declaration + snippetCost + guidelineCost,
			origin: toolOrigin(tool),
			note: tool.annotations?.readOnlyHint ? "read-only" : undefined,
		});
	}
	if (toolList) remainder("tool list preamble", toolList, snippetChars);
	if (rules) remainder("rules (pi + shared guidelines)", rules, guidelineChars);

	const skillsSection = take("skills");
	if (skillsSection) {
		let attributed = 0;
		for (const skill of (options.skills ?? []).filter((s) => !s.disableModelInvocation)) {
			const chars = skill.name.length + skill.description.length + skill.filePath.length + SKILL_FRAME_CHARS;
			attributed += chars;
			items.push({ kind: "skill", label: skill.name, chars, origin: originOf(skill.sourceInfo, "skill") });
		}
		remainder("skills preamble", skillsSection, attributed);
	}

	const filesSection = take("project_context");
	if (filesSection) {
		let attributed = 0;
		for (const file of options.contextFiles ?? []) {
			const chars = `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`.length + 2;
			attributed += chars;
			items.push({ kind: "context-file", label: shortPath(file.path), chars, origin: "context files" });
		}
		remainder("project context preamble", filesSection, attributed);
	}

	for (const section of sections.values()) {
		if (CORE_SECTIONS.has(section.name)) {
			items.push({ kind: "core", label: section.name, chars: section.text.length, origin: PI_ORIGIN });
		} else {
			const origin = section.name === "addendum" ? "APPEND_SYSTEM.md" : "extension prompt sections";
			items.push({ kind: "section", label: section.name, chars: section.text.length, origin });
		}
	}
	return items.sort((a, b) => b.chars - a.chars);
}
