import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	apply, applyBodyTransforms, asRelPath, assertNoCursorSeams, classify, plan, renderWrite,
} from "./reground-from-cursor.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "pstack-sync-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const from = join(root, "cursor");
	const to = join(root, "pi");
	const put = (base, rel, text) => {
		const file = join(base, rel);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	};
	const skill = (name) => `---\nname: ${name}\ndescription: Test skill.\nicon: crown\n---\n# ${name}\n\nBody.\n`;
	for (const name of ["how", "why", "unslop", "typescript-best-practices", "poteto-mode", "principle-explain-the-number", "make-bot-ui"]) {
		put(from, `skills/${name}/SKILL.md`, skill(name));
	}
	put(from, "skills/poteto-mode/playbooks/feature.md", "Use /how and [how](../../how/SKILL.md).\n");
	put(from, "skills/poteto-mode/scripts/example.ts", 'const command = "AskQuestion /how";\n');
	for (const name of ["deslop", "setup-pstack", "obsolete"]) put(to, `skills/${name}/SKILL.md`, skill(name));
	put(to, "skills/poteto-mode/scripts/check-plan.mjs", "// Pi checker\n");
	put(to, "README.md", "**47 skills**, not all 47. 23 playbooks and 23 principle skills.\n");
	put(to, "extensions/pstack/skill-catalog.test.ts", "assert.equal(skills.length, 47);\nassert.equal(skills.filter((skill) => skill.hidden).length, 43);\nassert.equal(hidden.length, 43);\n");
	put(to, "extensions/pstack/config.ts", "// Pi config\n");
	return { from, to, put };
}

test("asRelPath rejects traversal and absolute paths", () => {
	for (const path of ["..", "foo/../bar", "foo\\bar", "/abs"]) assert.throws(() => asRelPath(path));
	assert.equal(asRelPath("skills/how/SKILL.md"), "skills/how/SKILL.md");
});

test("classifies upstream content and preserves Pi forks", () => {
	assert.equal(classify("skills/typescript-best-practices/references/patterns.md"), "copy");
	assert.equal(classify("skills/how/SKILL.md"), "adapt");
	assert.equal(classify("skills/setup-pstack/SKILL.md"), "pi-only");
	assert.equal(classify("skills/make-bot-ui/SKILL.md"), "never-copy");
	assert.equal(classify("skills/principle-explain-the-number/SKILL.md"), "copy");
	assert.equal(classify("agents/poteto-agent.md"), "never-copy");
	assert.equal(classify("skills/poteto-mode/scripts/package.json"), "pi-only");
	assert.equal(classify("skills/poteto-mode/scripts/check-plan.test.ts"), "never-copy");
	assert.throws(() => classify("unclassified/new-file.md"), /unclassified/);
});

test("syncs a portable fixture, removes stale skills, and updates derived counts", (t) => {
	const paths = fixture(t);
	const planned = plan(paths);
	assert.deepEqual(planned.counts, { total: 8, discoverable: 4, hidden: 4, principles: 1, playbooks: 1 });
	assert.ok(planned.actions.some((a) => a.kind === "delete" && a.rel === "skills/obsolete/SKILL.md"));
	apply(planned);
	assertNoCursorSeams(paths.to);
	assert.equal(existsSync(join(paths.to, "skills/obsolete/SKILL.md")), false);
	assert.equal(existsSync(join(paths.to, "skills/make-bot-ui/SKILL.md")), false);
	assert.match(readFileSync(join(paths.to, "skills/deslop/SKILL.md"), "utf8"), /# deslop/);
	assert.equal(readFileSync(join(paths.to, "skills/poteto-mode/scripts/check-plan.mjs"), "utf8"), "// Pi checker\n");
	assert.match(readFileSync(join(paths.to, "README.md"), "utf8"), /\*\*8 skills\*\*, not all 8\. 1 playbooks and 1 principle skills/);
	const how = readFileSync(join(paths.to, "skills/how/SKILL.md"), "utf8");
	assert.doesNotMatch(how, /icon:|disable-model-invocation:/);
	assert.match(readFileSync(join(paths.to, "skills/principle-explain-the-number/SKILL.md"), "utf8"), /disable-model-invocation: true/);
	assert.match(readFileSync(join(paths.to, "skills/poteto-mode/playbooks/feature.md"), "utf8"), /Use \/skill:how and \[how\]\(\.\.\/\.\.\/how\/SKILL.md\)/);
	assert.equal(plan(paths).actions.filter((a) => a.kind === "patch" || a.kind === "delete").length, 0);
	for (const action of plan(paths).actions.filter((a) => a.kind === "write")) {
		assert.equal(readFileSync(action.dest, "utf8"), renderWrite(action, paths), action.rel);
	}
});

test("adapts commands without changing relative links or script contents", (t) => {
	const paths = fixture(t);
	plan(paths);
	assert.equal(applyBodyTransforms("Use /how. Read [how](../how/SKILL.md) and skills/how/SKILL.md."), "Use /skill:how. Read [how](../how/SKILL.md) and skills/how/SKILL.md.");
	assert.equal(renderWrite({ rel: "skills/poteto-mode/scripts/example.ts", class: "adapt" }, paths), 'const command = "AskQuestion /how";\n');
	assert.equal(applyBodyTransforms('`subagent_type: generalPurpose` with `run_in_background: true`'), '`agent: "worker"` with `async: true`');
	assert.equal(applyBodyTransforms("grok-4.7-xhigh-fast, claude-opus-5-5-xhigh"), "inherit-parent");
});

test("adapts why discovery without deleting the code anchor", (t) => {
	const paths = fixture(t);
	const anchor = "Before spawning investigators, build the seed context inline: file paths and key symbols. Run `git blame` and `git log`, then read PR discussions. This anchor goes to every investigator.";
	paths.put(paths.from, "skills/why/SKILL.md", `---\nname: why\ndescription: Why.\n---\n## Step 2. Establish the Code Anchor\n\n${anchor}\n\n## Step 3. Spawn Parallel Investigators\n\n### Discovery\n\nBefore spawning investigators, list the available MCPs from the Cursor environment. Otherwise inspect the \`mcps/\` directory Cursor exposes for enabled MCP servers.\n`);
	plan(paths);
	const rendered = renderWrite({ rel: "skills/why/SKILL.md", class: "adapt" }, paths);
	assert.ok(rendered.includes(anchor));
	assert.match(rendered, /### Discovery\n\nBefore spawning investigators, list the MCP servers and tools available in this Pi session/);
	assert.doesNotMatch(rendered, /Cursor environment|directory Cursor exposes/);
});

test("preserves the independent statechart toolchain on re-sync", (t) => {
	const paths = fixture(t);
	paths.put(paths.from, "skills/statechart/scripts/package.json", JSON.stringify({
		name: "@cursor-skill/statechart", private: true, type: "module",
		scripts: { test: "node --test test/*.test.ts" }, devDependencies: { "fast-check": "4.5.3" },
	}));
	const manifest = JSON.parse(renderWrite({ rel: "skills/statechart/scripts/package.json", class: "adapt" }, paths));
	assert.equal(manifest.name, "@zenspc/pi-pstack-statechart-tools");
	assert.equal(manifest.version, "0.0.0");
	assert.equal(manifest.packageManager, "pnpm@9.15.0");
	assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
	assert.equal(manifest.devDependencies["@types/node"], "22.20.5");
	assert.equal(classify("skills/statechart/scripts/pnpm-lock.yaml"), "pi-only");
});

test("keeps the Pi sticky-mode and model-selection contracts on re-sync", (t) => {
	const paths = fixture(t);
	paths.put(paths.from, "skills/poteto-mode/SKILL.md", `---\nname: poteto-mode\ndescription: Mode.\n---\n# Poteto mode\n\n## Subagents\n\n**Defaults for every \`Task\` call.** \`run_in_background: true\`, agent mode (readonly strips MCP), use grok-4.7-xhigh-fast.\n\n**Match the model to the job.** Synthesize suffixes.\n`);
	plan(paths);
	const rendered = renderWrite({ rel: "skills/poteto-mode/SKILL.md", class: "adapt" }, paths);
	assert.match(rendered, /`\/poteto-mode off` disables it/);
	assert.match(rendered, /subagents_enable/);
	assert.match(rendered, /Do not synthesize effort or speed suffixes/);
	assert.match(rendered, /omit `model`/);
	assert.match(rendered, /does not inherit MCP tools automatically/);
	assert.doesNotMatch(rendered, /run_in_background|grok-4\.7|Synthesize suffixes|readonly strips MCP/);
});
