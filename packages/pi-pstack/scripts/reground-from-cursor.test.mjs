import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { asRelPath, classify, plan } from "./reground-from-cursor.mjs";

const FROM = "/home/reyori/Projects/common-workspace/cursor-plugins/pstack";
const TO = join(dirname(fileURLToPath(import.meta.url)), "..");

test("asRelPath rejects traversal and absolute paths", () => {
	assert.throws(() => asRelPath(".."));
	assert.throws(() => asRelPath("foo/../bar"));
	assert.throws(() => asRelPath("foo\\bar"));
	assert.throws(() => asRelPath("/abs"));
	assert.equal(asRelPath("skills/how/SKILL.md"), "skills/how/SKILL.md");
});

test("classify live trees", () => {
	assert.equal(classify(asRelPath("skills/typescript-best-practices/references/patterns.md")), "copy");
	assert.equal(classify(asRelPath("skills/how/SKILL.md")), "adapt");
	assert.equal(classify(asRelPath("skills/setup-pstack/SKILL.md")), "pi-only");
	assert.equal(classify(asRelPath("skills/make-bot-ui/SKILL.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/principle-attack-the-premise/SKILL.md")), "copy");
	assert.equal(classify(asRelPath("agents/poteto-agent.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/package.json")), "pi-only");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/worktree-audit.sh")), "pi-only");
});

test("plan dry-run shape against live trees", () => {
	const planned = plan({ from: FROM, to: TO, dryRun: true });
	const writes = planned.actions.filter((action) => action.kind === "write");
	const deletes = planned.actions.filter((action) => action.kind === "delete");
	const skips = planned.actions.filter((action) => action.kind === "skip");
	const patches = planned.actions.filter((action) => action.derived);
	const writeRels = new Set(writes.map((action) => action.rel));
	const deleteRels = new Set(deletes.map((action) => action.rel));

	assert.ok(writeRels.has("skills/principle-attack-the-premise/SKILL.md"));
	assert.ok(writeRels.has("skills/principle-test-behavior-not-implementation/SKILL.md"));
	assert.equal(
		writes.find((action) => action.rel === "skills/principle-attack-the-premise/SKILL.md").class,
		"copy",
	);
	assert.equal(writes.find((action) => action.rel === "skills/how/SKILL.md").class, "adapt");

	for (const rel of [
		"skills/how/references/critic-prompt.md",
		"skills/how/references/critique-rubric.md",
	]) {
		assert.ok(!writeRels.has(rel));
		if (existsSync(join(TO, rel))) assert.ok(deleteRels.has(rel));
		else assert.ok(!deleteRels.has(rel));
	}

	assert.ok(
		skips.some((action) => action.rel === "skills/make-bot-ui/SKILL.md" && action.class === "never-copy"),
	);
	assert.ok(!writes.some((action) => action.rel.startsWith("extensions/") || /\/extensions\//.test(action.dest)));
	assert.ok(!writeRels.has("skills/make-bot-ui/SKILL.md"));
	assert.ok(!writeRels.has("skills/setup-pstack/SKILL.md"));
	assert.ok(!writeRels.has("skills/deslop/SKILL.md"));

	assert.equal(planned.counts.total, 47);
	assert.equal(planned.counts.discoverable, 4);
	assert.equal(planned.counts.hidden, 43);
	assert.equal(planned.counts.principles, 23);
	assert.equal(planned.counts.playbooks, 23);

	const catalog = readFileSync(join(TO, "extensions/pstack/skill-catalog.test.ts"), "utf8");
	if (!catalog.includes(`assert.equal(skills.length, ${planned.counts.total})`)) {
		assert.ok(patches.some((action) => action.derived === "catalog-counts"));
	}
	const readme = readFileSync(join(TO, "README.md"), "utf8");
	if (!readme.includes(`**${planned.counts.total} skills**`)) {
		assert.ok(patches.some((action) => action.derived === "readme-counts"));
	}
	const config = readFileSync(join(TO, "extensions/pstack/config.ts"), "utf8");
	if (config.includes("how critics")) {
		assert.ok(patches.some((action) => action.derived === "drop-how-critics"));
	}
});
