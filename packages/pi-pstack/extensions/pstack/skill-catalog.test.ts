import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
const DISCOVERABLE = ["how", "typescript-best-practices", "unslop", "why"];

type SkillFrontmatter = {
	name: string;
	hidden: boolean;
	body: string;
};

function parseSkill(dir: string): SkillFrontmatter {
	const text = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
	assert.ok(text.startsWith("---\n"), `${dir}: missing opening frontmatter`);
	const close = text.indexOf("\n---\n", 4);
	assert.ok(close !== -1, `${dir}: missing closing frontmatter`);
	const frontmatter = text.slice(4, close);
	const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	assert.ok(name, `${dir}: missing name`);
	return {
		name,
		hidden: /^disable-model-invocation:\s*true\s*$/m.test(frontmatter),
		body: text.slice(close + "\n---\n".length),
	};
}

function loadSkills(): SkillFrontmatter[] {
	return readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => parseSkill(entry.name));
}

describe("pstack skill catalog", () => {
	it("lists only how, why, unslop, and typescript-best-practices as Discoverable skills", () => {
		const skills = loadSkills();
		assert.equal(skills.length, 45);
		const discoverable = skills.filter((skill) => !skill.hidden).map((skill) => skill.name).sort();
		assert.deepEqual(discoverable, DISCOVERABLE);
		assert.equal(skills.filter((skill) => skill.hidden).length, 41);
	});

	it("keeps a Skill body for every Hidden skill so /skill:name can load it", () => {
		const hidden = loadSkills().filter((skill) => skill.hidden);
		assert.equal(hidden.length, 41);
		for (const skill of hidden) {
			assert.ok(skill.body.trim().length > 0, `${skill.name}: empty Skill body`);
		}
	});
});
