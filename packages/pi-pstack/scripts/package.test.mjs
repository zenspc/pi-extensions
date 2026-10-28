import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("published resources exclude nested development dependencies and extension tests", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pstack-package-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const put = (path, text) => {
		const file = join(dir, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	};
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	const workspace = JSON.parse(readFileSync(join(packageDir, "..", "..", "package.json"), "utf8"));
	put("package.json", JSON.stringify({ ...manifest, packageManager: workspace.packageManager }));
	put("extensions/pstack/index.ts", "export default () => {};\n");
	put("extensions/pstack/index.test.ts", "throw new Error('Do not ship');\n");
	put("skills/example/SKILL.md", "---\nname: example\ndescription: Example.\n---\nBody.\n");
	put("skills/example/scripts/node_modules/fake-dependency/index.js", "throw new Error('Do not ship');\n");
	const packed = spawnSync("pnpm", ["pack", "--pack-destination", "archive"], { cwd: dir, encoding: "utf8" });
	assert.equal(packed.status, 0, packed.stderr + packed.stdout);
	const archive = join(dir, "archive", `zenspc-pi-pstack-${manifest.version}.tgz`);
	const listed = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /package\/extensions\/pstack\/index\.ts\n/);
	assert.match(listed.stdout, /package\/skills\/example\/SKILL\.md\n/);
	assert.doesNotMatch(listed.stdout, /node_modules\/|index\.test\.ts/);
});
