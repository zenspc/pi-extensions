import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripSkillsByLocationPrefix } from "./skill-strip.ts";

const HEADER =
	"The following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.";

function skill(name: string, description: string, location: string): string {
	return `  <skill>\n    <name>${name}</name>\n    <description>${description}</description>\n    <location>${location}</location>\n  </skill>\n`;
}

const PSTACK_PREFIX = "/tmp/fake/pkg/skills";

function fixture(entries: string): string {
	return `\n\n${HEADER}\n\n<available_skills>\n${entries}</available_skills>`;
}

describe("stripSkillsByLocationPrefix", () => {
	it("returns input unchanged with removed 0 when no skills block exists", () => {
		const prompt = "\n\nYou are a coding agent.\n\n<other_section>hello</other_section>";
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});

	it("removes only pstack entries and keeps foreign entries byte-identical", () => {
		const architect = skill(
			"architect",
			"Sketch types, signatures, and module structure before code.",
			`${PSTACK_PREFIX}/architect/SKILL.md`,
		);
		const tdd = skill(
			"tdd",
			"Red, green, refactor with failing tests first.",
			`${PSTACK_PREFIX}/tdd/SKILL.md`,
		);
		const echo = skill("echo", "Echo text back.", "/tmp/other/skills/echo/SKILL.md");
		const prompt = fixture(architect + tdd + echo);
		const result = stripSkillsByLocationPrefix(prompt, `${PSTACK_PREFIX}/`);
		assert.equal(result.removed, 2);
		assert.equal(result.prompt, fixture(echo));
		assert.ok(result.prompt.includes("/tmp/other/skills/echo/SKILL.md"));
		assert.ok(!result.prompt.includes(PSTACK_PREFIX));
	});

	it("removes the whole section including the header sentence when every entry is pstack", () => {
		const entries =
			skill("architect", "Design first.", `${PSTACK_PREFIX}/architect/SKILL.md`) +
			skill("tdd", "Tests first.", `${PSTACK_PREFIX}/tdd/SKILL.md`);
		const prompt = fixture(entries);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 2);
		assert.ok(!result.prompt.includes("<available_skills>"));
		assert.ok(!result.prompt.includes("</available_skills>"));
		assert.ok(!result.prompt.includes("The following skills provide specialized instructions"));
		assert.equal(stripSkillsByLocationPrefix(fixture(skill("only", "one", `${PSTACK_PREFIX}/x/SKILL.md`)), PSTACK_PREFIX).removed, 1);
	});

	it("parses escaped descriptions without breaking or leaking unescaped entities", () => {
		const tricky = skill(
			"tricky",
			"Handles a &amp; b &lt;tag&gt; inputs.",
			`${PSTACK_PREFIX}/tricky/SKILL.md`,
		);
		const kept = skill("kept", "Plain.", "/tmp/other/skills/kept/SKILL.md");
		const prompt = fixture(tricky + kept);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 1);
		assert.equal(result.prompt, fixture(kept));
	});

	it("removes even the four Discoverable pstack skills", () => {
		const echo = skill("echo", "Echo text back.", "/tmp/other/skills/echo/SKILL.md");
		const prompt = fixture(
			skill("how", "How.", `${PSTACK_PREFIX}/how/SKILL.md`) +
				skill("why", "Why.", `${PSTACK_PREFIX}/why/SKILL.md`) +
				skill("unslop", "Unslop.", `${PSTACK_PREFIX}/unslop/SKILL.md`) +
				skill("typescript-best-practices", "TS.", `${PSTACK_PREFIX}/typescript-best-practices/SKILL.md`) +
				echo,
		);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 4);
		assert.equal(result.prompt, fixture(echo));
	});

	it("returns input unchanged for an empty prefix", () => {
		const prompt = fixture(skill("architect", "Design.", `${PSTACK_PREFIX}/architect/SKILL.md`));
		const result = stripSkillsByLocationPrefix(prompt, "");
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});

	it("returns input unchanged when the closing tag is missing", () => {
		const prompt = `\n\n<available_skills>\n${skill("architect", "Design.", `${PSTACK_PREFIX}/architect/SKILL.md`)}`;
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});
});
