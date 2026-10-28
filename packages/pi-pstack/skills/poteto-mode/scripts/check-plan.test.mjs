import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const playbook = readFileSync(join(here, "../playbooks/multi-phase-plan.md"), "utf8");
const open = playbook.indexOf("````markdown\n");
assert.notEqual(open, -1, "playbook is missing the skeleton fence");
const start = open + "````markdown\n".length;
const close = playbook.indexOf("````", start);
assert.notEqual(close, -1, "playbook skeleton fence is unclosed");
const skeleton = playbook.slice(start, close);

function runPlan(t, example = "", expectedExit = 0) {
	const dir = mkdtempSync(join(tmpdir(), "check-plan-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "plan.md");
	writeFileSync(file, skeleton + example);
	const result = spawnSync(process.execPath, [join(here, "check-plan.mjs"), file], { encoding: "utf8" });
	assert.equal(result.status, expectedExit, result.stderr + result.stdout);
	return result;
}

test("bundled multi-phase-plan skeleton passes check-plan.mjs", (t) => runPlan(t));

test("accepts indented, longer, nested, and tilde fences", (t) => {
	for (const indent of ["", " ", "  ", "   "]) {
		runPlan(t, `${indent}\`\`\`markdown\n## Example only\n${indent}\`\`\`\n`);
	}
	runPlan(t, "```markdown\n## Example only\n````\n");
	runPlan(t, "````markdown\n```markdown\n## Example only\n```\n````\n");
	runPlan(t, "~~~markdown `info`\n## Example only\n ~~~\n");
});

test("keeps mismatched, shorter, and suffixed closers inside the fence", (t) => {
	for (const closer of ["~~~", "```", "``` info"]) {
		runPlan(t, `\`\`\`\`markdown\n${closer}\n## Example only\n\`\`\`\`\n`);
	}
});

test("checks headings and prose after a proper close", (t) => {
	for (const suffix of ["  ", "\t"]) {
		const result = runPlan(t, `\`\`\`markdown\n## Example only\n\`\`\`${suffix}\n## Example only\n`, 1);
		assert.match(result.stderr, /after Close the program is not an appendix/);
	}
	assert.match(runPlan(t, "```markdown\nBad: inside code\n```\nBad: prose.\n", 1).stderr, /mid-sentence colon/);
});

test("rejects backtick info strings containing a backtick", (t) => {
	assert.match(runPlan(t, "```markdown `invalid`\n## Example only\n```\n", 1).stderr, /after Close the program is not an appendix/);
});

test("ignores punctuation only inside matching inline code spans", (t) => {
	for (const count of [2, 3, 4]) {
		const delimiter = "`".repeat(count);
		runPlan(t, `Use ${delimiter}echo \`x\`: \u201cquoted\u201d \u2014 example${delimiter}.\n`);
	}
	assert.match(runPlan(t, "Use ``echo `x`: y``. Bad: prose.\n", 1).stderr, /mid-sentence colon/);
	assert.match(runPlan(t, "Use ``unclosed: bad` here.\n", 1).stderr, /mid-sentence colon/);
});
