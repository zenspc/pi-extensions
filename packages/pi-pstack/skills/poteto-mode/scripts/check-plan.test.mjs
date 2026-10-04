import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("bundled multi-phase-plan skeleton passes check-plan.mjs", () => {
	const playbook = readFileSync(join(here, "../playbooks/multi-phase-plan.md"), "utf8");
	const open = playbook.indexOf("````markdown\n");
	assert.notEqual(open, -1, "playbook is missing the skeleton fence");
	const start = open + "````markdown\n".length;
	const close = playbook.indexOf("````", start);
	assert.notEqual(close, -1, "playbook skeleton fence is unclosed");
	const dir = mkdtempSync(join(tmpdir(), "check-plan-"));
	const file = join(dir, "plan.md");
	writeFileSync(file, playbook.slice(start, close));
	const result = spawnSync(process.execPath, [join(here, "check-plan.mjs"), file], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr + result.stdout);
});
