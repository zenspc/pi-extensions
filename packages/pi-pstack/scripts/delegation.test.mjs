import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyBodyTransforms, classify } from "./reground-from-cursor.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("read-only worker workflows link the scoped Pi acceptance contract", () => {
	for (const name of ["how", "why", "reflect", "interrogate", "arena", "swarm", "maintain-verification-skill"]) {
		const body = readFileSync(join(packageDir, "skills", name, "SKILL.md"), "utf8");
		assert.match(body, /\[Pi delegation controls\]\(\.\.\/poteto-mode\/references\/pi-delegation\.md\)/, name);
		const rel = `skills/${name}/SKILL.md`;
		const rendered = applyBodyTransforms(`# ${name}\n\nReview the fixture.\n`, rel);
		assert.match(rendered, /Pi delegation controls/);
		assert.equal(applyBodyTransforms(rendered, rel), rendered);
	}
	assert.equal(classify("skills/poteto-mode/references/pi-delegation.md"), "pi-only");
	const contract = readFileSync(join(packageDir, "skills/poteto-mode/references/pi-delegation.md"), "utf8");
	const policy = JSON.parse(contract.match(/```json\n([^]*?)\n```/)[1]);
	assert.equal(policy.acceptance.level, "none");
	assert.ok(policy.acceptance.reason);
	assert.match(contract, /Retain inferred or explicit evidence gates for code-writing delegates/);
});

test("workflow verification matrix accounts for every bundled skill, playbook, and agent", () => {
	const plan = readFileSync(join(packageDir, "../../docs/pi-pstack-verification-plan.md"), "utf8");
	for (const [kind, dir, suffix] of [
		["skill", "skills", ""],
		["playbook", "skills/poteto-mode/playbooks", ".md"],
		["agent", "agents", ".md"],
	]) {
		for (const entry of readdirSync(join(packageDir, dir), { withFileTypes: true })) {
			if (suffix ? !entry.name.endsWith(suffix) : !entry.isDirectory()) continue;
			const name = suffix ? entry.name.slice(0, -suffix.length) : entry.name;
			assert.equal(plan.split(`\`${kind}:${name}\``).length - 1, 1, `${kind}:${name} needs exactly one matrix row`);
		}
	}
});
