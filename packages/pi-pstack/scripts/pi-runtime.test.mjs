import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { patchModelInstructions, patchRuntimeInstructions, runtimeInstructionIssues } from "./pi-runtime.mjs";
import { applyBodyTransforms, assertNoCursorSeams, classify } from "./reground-from-cursor.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("installed skill instructions satisfy the Pi runtime contract", () => {
	assertNoCursorSeams(root);
	for (const file of readdirSync(join(root, "skills"), { recursive: true })) {
		if (!file.endsWith(".md") || file.split("/").includes("node_modules")) continue;
		const rel = `skills/${file}`;
		const text = readFileSync(join(root, rel), "utf8");
		assert.deepEqual(runtimeInstructionIssues(text, rel), [], rel);
		assert.equal(patchRuntimeInstructions(text, rel), text, `non-idempotent: ${rel}`);
		assert.equal(patchModelInstructions(text, rel), text, `non-idempotent model instructions: ${rel}`);
		for (const match of text.matchAll(/\]\(([^)]+pi-(?:runtime|models)\.md)\)/g)) {
			assert.ok(existsSync(join(root, dirname(rel), match[1])), `${rel}: ${match[1]}`);
		}
	}
});

test("sync replaces executable wake assumptions with verified delivery and a fallback", () => {
	const cases = [
		["autonomous-run", "2. Pick the wake mechanism using a recurring wake (a built-in, not a pstack skill)."],
		["autopilot-full", "On the operator's go, arm `a recurring 1-hour wake` to audit until no delegated work is left. Each tick probes all owners."],
		["multi-phase-plan", "- [ ] On the operator's go, arm the audit tick as `a recurring 1-hour wake` with the tick prompt below. Never leave the cadence to memory."],
		["babysit", "Run `drive` and `background` under a recurring wake in dynamic mode."],
		["shipping", "Watch under a recurring wake until it reports COMPLETE."],
		["visual-parity", "Investigate the pixel delta. a recurring wake per component until the diff is zero."],
	];
	for (const [name, body] of cases) {
		const rel = `skills/poteto-mode/playbooks/${name}.md`;
		const source = `### ${name}\n\n${body}\n`;
		assert.ok(runtimeInstructionIssues(source, rel).length > 0, name);
		const rendered = applyBodyTransforms(source, rel);
		assert.deepEqual(runtimeInstructionIssues(rendered, rel), [], name);
		assert.match(rendered, /references\/pi-runtime.md/);
		assert.equal(applyBodyTransforms(rendered, rel), rendered);
	}
	assert.ok(runtimeInstructionIssues("Read [runtime](../references/pi-runtime.md). On the operator\'s go, arm the audit tick as `a recurring 1-hour wake`.", "skills/poteto-mode/playbooks/multi-phase-plan.md").includes("unconditional hourly wake"));
	assert.equal(applyBodyTransforms("a cloud-agent URL, or a pushed branch"), "a retained pi-subagents run record, or a pushed branch");
	assert.equal(classify("skills/poteto-mode/references/pi-runtime.md"), "pi-only");
});

test("transcript adaptation removes upstream layouts rather than globally searching sessions", () => {
	const rel = "skills/reflect/SKILL.md";
	const source = "# Reflect\n\n## 1. Locate\n\nBefore fanning out, find this conversation's transcript in the `agent-transcripts/` directory the system prompt names.\n\n```bash\nls -t <agent-transcripts>/*.jsonl\n```\n\nRead the first JSONL message.\n\n## 2. Spawn\n\nKeep reviewer instructions.\n";
	const rendered = applyBodyTransforms(source, rel);
	assert.deepEqual(runtimeInstructionIssues(rendered, rel), []);
	assert.match(rendered, /verified workspace-scoped file or a bounded digest/);
	assert.match(rendered, /Keep reviewer instructions/);
	assert.doesNotMatch(rendered, /ls -t|first JSONL message/);
	const contract = readFileSync(join(root, "skills/poteto-mode/references/pi-runtime.md"), "utf8");
	for (const required of [/\$PI_SESSION_FILE/, /header's `cwd`/, /Do not guess/, /exact paths/, /unattended continuation is unavailable/, /cancellation method/, /active branch/, /not new authorization/]) {
		assert.match(contract, required);
	}
});

test("sync preserves effective model reporting and replaces Cursor-family fallbacks", () => {
	for (const name of ["arena", "interrogate", "architect"]) {
		const rel = `skills/${name}/SKILL.md`;
		const fallback = "If the subagent tool rejects a configured entry, run that seat on its family's default. Families go by prefix: `claude-*`, `grok-*`, `cursor-grok-*`, and `composer-*`.";
		const source = `# ${name}\n\n${name === "arena" ? `3. Pick the runners. ${fallback} Spawn more runners when needed.` : name === "interrogate" ? fallback : "Use Arena."}\n`;
		assert.ok(runtimeInstructionIssues(source, rel).length > 0);
		const rendered = applyBodyTransforms(source, rel);
		assert.deepEqual(runtimeInstructionIssues(rendered, rel), []);
		assert.match(rendered, /report effective models and label same-model panels/);
		assert.doesNotMatch(rendered, /Families go by prefix|cursor-grok|composer-\*/);
		assert.equal(applyBodyTransforms(rendered, rel), rendered);
	}
	assert.equal(classify("skills/poteto-mode/references/pi-models.md"), "pi-only");
	const contract = readFileSync(join(root, "skills/poteto-mode/references/pi-models.md"), "utf8");
	for (const required of [/one seat per array entry/, /actual run metadata/, /same-model panel/, /confirmed available selectors/, /Do not silently select another paid provider/, /report that seat blocked/]) assert.match(contract, required);
});

test("historical upstream references are not executable capability failures", () => {
	assert.deepEqual(runtimeInstructionIssues("This port replaces Cursor's built-in babysit skill. Cursor Custom Modes are not provided.", "skills/how/SKILL.md"), []);
});
