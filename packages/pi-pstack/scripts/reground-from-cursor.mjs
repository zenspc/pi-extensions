#!/usr/bin/env node
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DISCOVERABLE = ["how", "typescript-best-practices", "unslop", "why"];

const EXTENSION_COMMANDS = new Set(["/poteto-mode", "/setup-pstack", "/pstack"]);

const CURSOR_FRONTMATTER_KEYS = new Set(["mode", "icon", "color", "reminder", "paths"]);

const CURSOR_SLUG_ALT =
	"grok-4\\.6-fast-xhigh|claude-fable-5-1-thinking-max|gpt-5\\.6-sol-max|claude-opus-5-thinking-xhigh";
const CURSOR_DEFAULT_SLUGS = new RegExp(
	"`?(?:" + CURSOR_SLUG_ALT + ")`?(?:\\s*,\\s*`?(?:" + CURSOR_SLUG_ALT + ")`?)*",
	"g",
);

export const CLASS_RULES = [
	{ pattern: "skills/make-bot-ui/**", class: "never-copy" },
	{ pattern: "make-bot-ui/**", class: "never-copy" },
	{ pattern: "assets/**", class: "never-copy" },
	{ pattern: "automations/**", class: "never-copy" },
	{ pattern: "docs/**", class: "never-copy" },
	{ pattern: ".cursor-plugin/**", class: "never-copy" },
	{ pattern: "agents/**", class: "never-copy" },
	{ pattern: "README.md", class: "never-copy" },
	{ pattern: "LICENSE", class: "never-copy" },

	{ pattern: "skills/deslop/**", class: "pi-only" },
	{ pattern: "skills/setup-pstack/SKILL.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.test.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/package.json", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/bun.lock", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/worktree-audit.sh", class: "pi-only" },

	{ pattern: "skills/principle-*/**", class: "copy" },
	{ pattern: "skills/typescript-best-practices/references/patterns.md", class: "copy" },

	{ pattern: "skills/**", class: "adapt" },
];

const DEST_ONLY_NEVER = [
	"extensions/**",
	"package.json",
	"CHANGELOG.md",
	"agents/**",
	"README.md",
];

const KNOWN_TOP = new Set(
	CLASS_RULES.map((rule) => rule.pattern.split("/")[0].replaceAll("*", "")).filter(Boolean),
);

const SKIP_WALK = new Set([".git", "node_modules"]);

let skillNamesForSlash = new Set(["deslop"]);

export const SEAMS = [
	{
		id: "ask-question",
		cursor: /AskQuestion/g,
		pi: "ask_user_question",
	},
	{
		id: "models-path",
		cursor: /~\/\.cursor\/rules\/pstack-models\.mdc/g,
		pi: "~/.pi/agent/pstack/models.json",
	},
	{
		id: "sessions-path",
		cursor: /~\/\.cursor\/projects\/[^`\s]*/g,
		pi: "~/.pi/agent/sessions/",
	},
	{
		id: "skills-dir",
		cursor: /(?:~\/\.cursor\/skills\/|\.cursor\/skills\/)/g,
		pi: (m) => (m.startsWith("~") ? "~/.pi/agent/skills/" : ".pi/skills/"),
	},
	{
		id: "plugins-dir",
		cursor: /~\/\.cursor\/plugins\//g,
		pi: "~/.pi/agent/npm/node_modules/",
	},
	{
		id: "deslop",
		cursor: /the `deslop` skill from the `cursor-team-kit` plugin \(`\/deslop`\)|(?<!skill:)\/deslop\b/g,
		pi: (m) => (m.includes("cursor-team-kit") ? "the **deslop** skill (`/skill:deslop`)" : "/skill:deslop"),
	},
	{
		id: "control-pair",
		cursor: /`control-ui` or `control-cli`|`control-cli` or `control-ui`/g,
		pi: "the project's verification skill or harness",
	},
	{
		id: "control-from",
		cursor:
			/`control-ui` from (?:`[^`]*`|\.)|`control-cli` from (?:`[^`]*`|\.)/g,
		pi: "the project's verification skill or harness",
	},
	{
		id: "control-publish",
		cursor:
			/the matching control skill\.\s*(?:`[^`]+`\s*)?publishes `control-cli` \(CLIs and TUIs\) and `control-ui` \(browser \/ Electron \/ web UIs\)/g,
		pi: "verify on the real surface: drive the browser or app through the project's verification skill or an automation harness",
	},
	{
		id: "cursor-team-kit",
		cursor: /`cursor-team-kit`|cursor-team-kit/g,
		pi: "the project's verification skill",
	},
	{
		id: "subagent-poteto",
		cursor: /subagent_type:\s*"poteto-agent"/g,
		pi: 'subagent({ agent: "poteto-agent", task })',
	},
	{
		id: "subagent-sicko",
		cursor: /subagent_type:\s*"Comment Sicko"/g,
		pi: 'subagent({ agent: "comment-sicko", task })',
	},
	{
		id: "subagent-worker",
		cursor: /`subagent_type`:\s*`generalPurpose`|subagent_type:\s*"generalPurpose"|subagent_type:\s*`?generalPurpose`?/g,
		pi: 'agent: "worker"',
	},
	{
		id: "subagent-type-leftover",
		cursor: /`subagent_type`|subagent_type/g,
		pi: "agent",
	},
	{
		id: "inherit-parent",
		cursor: CURSOR_DEFAULT_SLUGS,
		pi: "inherit-parent",
	},
	{
		id: "task-subagent",
		cursor: /Task subagent/g,
		pi: "subagent",
	},
	{
		id: "task-call",
		cursor: /every `Task` call/g,
		pi: "every `subagent()` launch",
	},
	{
		id: "task-calls",
		cursor: /`Task` calls/g,
		pi: "`subagent()` launches",
	},
	{
		id: "task-call-one",
		cursor: /One `Task` call/g,
		pi: "One `subagent()` launch",
	},
	{
		id: "three-task",
		cursor: /three `Task` calls/g,
		pi: "three `subagent()` launches",
	},
	{
		id: "readonly-true",
		cursor: /`readonly`: `true`/g,
		pi: "tools: read-only (`read, grep, find, ls, bash`)",
	},
	{
		id: "create-skill-builtin",
		cursor: /the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)/g,
		pi: "`playbooks/authoring-a-skill.md` and `/skill:unslop`",
	},
	{
		id: "create-skill-use",
		cursor: /Use the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)\./g,
		pi: "Author SKILL.md to the Pi Agent Skills standard. Run `/skill:unslop` on every line.",
	},
	{
		id: "create-skill-cursor",
		cursor: /Cursor's built-in `create-skill`/g,
		pi: "`playbooks/authoring-a-skill.md`",
	},
	{
		id: "create-skill-tick",
		cursor: /`create-skill`/g,
		pi: "`playbooks/authoring-a-skill.md`",
	},
	{
		id: "create-skill-bare",
		cursor: /create-skill/g,
		pi: "authoring-a-skill",
	},
	{
		id: "under-loop",
		cursor: /under `\/loop`/g,
		pi: "under a recurring wake",
	},
	{
		id: "cursor-loop",
		cursor: /Cursor's `\/loop` command/g,
		pi: "a recurring wake",
	},
	{
		id: "with-loop",
		cursor: /with Cursor's `\/loop` command/g,
		pi: "with a recurring wake",
	},
	{
		id: "slash-loop",
		cursor: /`\/loop`/g,
		pi: "a recurring wake",
	},
	{
		id: "babysit-cursor",
		cursor: /not Cursor's built-in babysit skill/g,
		pi: "not any generic review command",
	},
	{
		id: "loop-until",
		cursor: /\/loop until X/g,
		pi: "run until X",
	},
	{
		id: "loop-command",
		cursor: /Cursor's `\/loop` command \(a built-in, not a pstack skill\)/g,
		pi: "a recurring wake or watcher loop (a built-in, not a pstack skill)",
	},
	{
		id: "loop-terminal",
		cursor: /a real terminal `\/loop`/g,
		pi: "a recurring wake",
	},
	{
		id: "home-cursor",
		cursor: /\$HOME\/\.cursor\/projects\/[^\s"']*/g,
		pi: "$HOME/.pi/agent/sessions",
	},
	{
		id: "cloud-agent",
		cursor: /, cloud-agent URL,/g,
		pi: ", an async run record,",
	},
	{
		id: "cursor-restart",
		cursor: /, a Cursor restart,/g,
		pi: ", a restart,",
	},
	{
		id: "cloud-vm",
		cursor: /on its own cloud VM at the PR head/g,
		pi: "at the PR head",
	},
	{
		id: "setup-rule",
		cursor: /the `\/setup-pstack` rule/g,
		pi: "the injected pstack role table",
	},
	{
		id: "ten-lanes",
		cursor: /Ten lanes on [^\n]+ at the PR head/g,
		pi: "Ten lanes at the PR head",
	},
	{
		id: "check-plan-path",
		cursor: /node pstack\/skills\/poteto-mode\/scripts\/check-plan\.mjs/g,
		pi: "node skills/poteto-mode/scripts/check-plan.mjs",
	},
	{
		id: "standing-goal",
		cursor: /arm a `\/goal` with this exact text/g,
		pi: "record a standing goal with this exact text",
	},
	{
		id: "standing-goal-tick",
		cursor: /the armed \/goal/g,
		pi: "the standing goal",
	},
	{
		id: "slash-skill",
		cursor: /(?<![\w/])\/([a-z][a-z0-9-]*)\b/g,
		pi: (m, name) => {
			if (EXTENSION_COMMANDS.has(`/${name}`)) return m;
			if (!skillNamesForSlash.has(name)) return m;
			return `/skill:${name}`;
		},
	},
];

function matchGlob(rel, pattern) {
	let out = "";
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "*" && pattern[i + 1] === "*") {
			out += ".*";
			i++;
		} else if (pattern[i] === "*") {
			out += "[^/]*";
		} else if (".+^${}()|[]\\".includes(pattern[i])) {
			out += `\\${pattern[i]}`;
		} else {
			out += pattern[i];
		}
	}
	return new RegExp(`^${out}$`).test(rel);
}

function matchesAny(rel, patterns) {
	return patterns.some((pattern) => matchGlob(rel, pattern));
}

export function asRelPath(value) {
	if (typeof value !== "string" || value === "") {
		throw new Error("rel path required");
	}
	if (value.includes("\\") || value.includes("..") || value.startsWith("/")) {
		throw new Error(`invalid rel path: ${value}`);
	}
	return value;
}

export function classify(rel) {
	rel = asRelPath(rel);
	for (const rule of CLASS_RULES) {
		if (matchGlob(rel, rule.pattern)) return rule.class;
	}
	if (rel === "skills" || rel.startsWith("skills/")) return "adapt";
	const top = rel.split("/")[0];
	if (rel.includes("/") && !top.startsWith(".") && !KNOWN_TOP.has(top)) {
		throw new Error(`unclassified Cursor path: ${rel}`);
	}
	return "never-copy";
}

export function parseArgs(argv) {
	let from;
	let to;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from") {
			from = argv[++i];
		} else if (arg === "--to") {
			to = argv[++i];
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else {
			throw new Error(`unknown arg: ${arg}`);
		}
	}
	if (!from || !to) {
		throw new Error("usage: --from <cursor-pstack> --to <pi-pstack> [--dry-run]");
	}
	from = resolve(from);
	to = resolve(to);
	if (!existsSync(join(from, "skills"))) {
		throw new Error(`no skills/ in ${from}`);
	}
	if (!existsSync(join(to, "skills"))) {
		throw new Error(`no skills/ in ${to}`);
	}
	return { from, to, dryRun };
}

function walkFiles(root) {
	const out = [];
	function rec(dir, relBase) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP_WALK.has(ent.name)) continue;
			const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
			const abs = join(dir, ent.name);
			if (ent.isDirectory()) rec(abs, rel);
			else out.push(asRelPath(rel));
		}
	}
	rec(root, "");
	return out;
}

function refreshSkillNames(fromRoot, toRoot) {
	skillNamesForSlash = new Set(["deslop"]);
	for (const root of [fromRoot, toRoot]) {
		const dir = join(root, "skills");
		if (!existsSync(dir)) continue;
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (ent.isDirectory() && ent.name !== "make-bot-ui") {
				skillNamesForSlash.add(ent.name);
			}
		}
	}
}

function skillDirsAfter(to, actions) {
	const dir = join(to, "skills");
	const dirs = new Set(
		readdirSync(dir, { withFileTypes: true })
			.filter((ent) => ent.isDirectory())
			.map((ent) => ent.name),
	);
	for (const action of actions) {
		const rel = action.rel;
		if (!rel) continue;
		const m = /^skills\/([^/]+)\//.exec(rel);
		if (!m) continue;
		if (action.kind === "write") dirs.add(m[1]);
		if (action.kind === "delete" && rel === `skills/${m[1]}/SKILL.md`) dirs.delete(m[1]);
	}
	return dirs;
}

function playbookCountAfter(to, actions) {
	const dir = join(to, "skills/poteto-mode/playbooks");
	const files = new Set(
		existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : [],
	);
	for (const action of actions) {
		const m = action.rel && /^skills\/poteto-mode\/playbooks\/([^/]+\.md)$/.exec(action.rel);
		if (!m) continue;
		if (action.kind === "write") files.add(m[1]);
		if (action.kind === "delete") files.delete(m[1]);
	}
	return files.size;
}

function readOptional(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function needsCatalogCounts(to, counts) {
	const text = readOptional(join(to, "extensions/pstack/skill-catalog.test.ts"));
	return (
		!text.includes(`assert.equal(skills.length, ${counts.total})`) ||
		!text.includes(`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`) ||
		!text.includes(`assert.equal(hidden.length, ${counts.hidden})`)
	);
}

function needsReadmeCounts(to, counts) {
	const text = readOptional(join(to, "README.md"));
	return (
		!text.includes(`**${counts.total} skills**`) ||
		!text.includes(`${counts.playbooks} playbooks`) ||
		!text.includes(`${counts.principles} principle skills`) ||
		!text.includes(`not all ${counts.total}`)
	);
}

function needsDropHowCritics(to) {
	const files = [
		"extensions/pstack/config.ts",
		"extensions/pstack/config.test.ts",
		"skills/setup-pstack/SKILL.md",
	];
	return files.some((rel) => readOptional(join(to, rel)).includes("how critics"));
}

const POTETO_INTRO = [
	"`/poteto-mode` enables this mode for the rest of the session.",
	"`/poteto-mode off` disables it.",
	"`/skill:poteto-mode` also enables it.",
	"The role table is injected from `~/.pi/agent/pstack/models.json` only when a role has a real model slug.",
	"",
	"",
].join("\n");

const SUBAGENT_DEFAULTS =
	"**Defaults for every `subagent()` launch.** file pointers not inlined context. The default for every role is the parent session model (`inherit-parent`; omit `model`). `/setup-pstack` writes `~/.pi/agent/pstack/models.json` and overrides per role. Pass a configured real slug as `model:`. `inherit-parent` and `auto` mean omit `model`. Code delegates tier by difficulty. The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) go to the model configured for `hardest tasks`, else the parent model, when the task needs judgment or the intent is vague, and to your strongest instruction-following model when the work is a precisely specified sequence of steps to execute to the letter; trivial mechanical edits go to your fast code model. Per-role lines in the injected pstack role table override these defaults and the model choices in the routed skills (`how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`); a role with no line keeps its default.";

function patchPotetoModePi(text) {
	if (!text.includes("`/poteto-mode` enables this mode")) {
		text = text.replace("# Poteto mode\n\n", `# Poteto mode\n\n${POTETO_INTRO}`);
	}
	text = text.replace(/\*\*Defaults for every `Task` call\.\*\*[^\n]*/, SUBAGENT_DEFAULTS);
	text = text.replace(/\*\*Defaults for every `subagent\(\)` launch\.\*\*`run_in_background:[^\n]*/, SUBAGENT_DEFAULTS);
	return text;
}

export function plan(paths) {
	refreshSkillNames(paths.from, paths.to);
	const cursorRels = walkFiles(paths.from);
	const cursorSet = new Set(cursorRels);
	const actions = [];

	for (const rel of cursorRels) {
		const fileClass = classify(rel);
		if (fileClass === "never-copy" || fileClass === "pi-only") {
			actions.push({ kind: "skip", rel, class: fileClass });
			continue;
		}
		actions.push({
			kind: "write",
			rel,
			dest: join(paths.to, rel),
			class: fileClass,
		});
	}

	const destSkillRoot = join(paths.to, "skills");
	const destRels = existsSync(destSkillRoot)
		? walkFiles(destSkillRoot).map((rel) => asRelPath(`skills/${rel}`))
		: [];
	for (const rel of destRels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only") continue;
		const counterpart = cursorSet.has(rel) ? classify(rel) : null;
		if (counterpart === "copy" || counterpart === "adapt") continue;
		if (counterpart === "pi-only") continue;
		actions.push({ kind: "delete", dest: join(paths.to, rel), rel });
	}

	const dirs = skillDirsAfter(paths.to, actions);
	const counts = {
		total: dirs.size,
		discoverable: DISCOVERABLE.length,
		hidden: dirs.size - DISCOVERABLE.length,
		principles: [...dirs].filter((name) => name.startsWith("principle-")).length,
		playbooks: playbookCountAfter(paths.to, actions),
	};

	if (needsCatalogCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "extensions/pstack/skill-catalog.test.ts"),
			derived: "catalog-counts",
		});
	}
	if (needsReadmeCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "README.md"),
			derived: "readme-counts",
		});
	}
	if (needsDropHowCritics(paths.to)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "extensions/pstack/config.ts"),
			derived: "drop-how-critics",
		});
	}

	return { paths, actions, counts };
}

export function printPlan(planned) {
	const tallies = { write: 0, delete: 0, patch: 0, skip: 0 };
	for (const action of planned.actions) {
		tallies[action.kind] += 1;
		if (action.kind === "write") {
			console.log(`write\t${action.class}\t${action.rel}`);
		} else if (action.kind === "delete") {
			console.log(`delete\t\t${action.rel}`);
		} else if (action.kind === "patch") {
			console.log(`patch\t${action.derived}\t${action.dest}`);
		} else {
			console.log(`skip\t${action.class}\t${action.rel}`);
		}
	}
	console.log(
		`# ${tallies.write} write, ${tallies.delete} delete, ${tallies.patch} patch, ${tallies.skip} skip`,
	);
	console.log(
		`# catalog ${planned.counts.total}/${planned.counts.discoverable}/${planned.counts.hidden} principles ${planned.counts.principles} playbooks ${planned.counts.playbooks}`,
	);
}

function frontmatterKey(line) {
	const i = line.indexOf(":");
	return i === -1 ? "" : line.slice(0, i).trim();
}

export function applyFrontmatterPolicy(text, skillDir) {
	if (!text.startsWith("---\n")) return text;
	const close = text.indexOf("\n---\n", 4);
	if (close === -1) return text;
	const body = text.slice(close + "\n---\n".length);
	const lines = text
		.slice(4, close)
		.split("\n")
		.map((line) => line.replace(/^name:\s*"?Poteto Mode"?\s*$/, "name: poteto-mode"))
		.filter((line) => {
			const key = frontmatterKey(line);
			if (CURSOR_FRONTMATTER_KEYS.has(key)) return false;
			if (key === "disable-model-invocation") return false;
			return true;
		});
	if (!DISCOVERABLE.includes(skillDir)) {
		lines.push("disable-model-invocation: true");
	}
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function applyBodyTransforms(text, _rel) {
	for (let i = 0; i < 20; i++) {
		let next = text;
		for (const seam of SEAMS) {
			next = next.replace(seam.cursor, seam.pi);
		}
		if (next === text) return next;
		text = next;
	}
	throw new Error("seam fixpoint did not converge");
}

export function renderWrite(action, paths) {
	const src = join(paths.from, action.rel);
	let text = readFileSync(src, "utf8");
	const parts = action.rel.split("/");
	const base = parts[parts.length - 1];
	const skillDir = parts[0] === "skills" ? parts[1] : "";
	if (base === "SKILL.md") {
		text = applyFrontmatterPolicy(text, skillDir);
	}
	if (action.class === "adapt") {
		text = applyBodyTransforms(text, action.rel);
	}
	if (action.rel === "skills/poteto-mode/SKILL.md") {
		text = patchPotetoModePi(text);
	}
	return text;
}

function writeIfChanged(dest, text, modeSrc) {
	mkdirSync(dirname(dest), { recursive: true });
	if (existsSync(dest) && readFileSync(dest, "utf8") === text) return false;
	const opts = {};
	if (modeSrc && existsSync(modeSrc)) {
		opts.mode = lstatSync(modeSrc).mode & 0o777;
	} else if (existsSync(dest)) {
		opts.mode = lstatSync(dest).mode & 0o777;
	}
	writeFileSync(dest, text, opts);
	return true;
}

function patchCatalogCounts(text, counts) {
	return text
		.replace(/assert\.equal\(skills\.length, \d+\)/g, `assert.equal(skills.length, ${counts.total})`)
		.replace(
			/assert\.equal\(skills\.filter\(\(skill\) => skill\.hidden\)\.length, \d+\)/g,
			`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`,
		)
		.replace(/assert\.equal\(hidden\.length, \d+\)/g, `assert.equal(hidden.length, ${counts.hidden})`);
}

function patchReadmeCounts(text, counts) {
	return text
		.replace(/\*\*\d+ skills\*\*/g, `**${counts.total} skills**`)
		.replace(/not all \d+/g, `not all ${counts.total}`)
		.replace(/\d+ playbooks/g, `${counts.playbooks} playbooks`)
		.replace(/\d+ principle skills/g, `${counts.principles} principle skills`);
}

function dropHowCriticsFromConfig(text) {
	return text.replace(/\n\t"how critics",/g, "");
}

function dropHowCriticsFromSetup(text) {
	return text
		.replace("how explainer; how critics; why investigators", "how explainer; why investigators")
		.replace("(`how critics`, `arena runners`", "(`arena runners`");
}

export function applyDerivedPatch(kind, destRoot, counts) {
	if (kind === "catalog-counts") {
		const dest = join(destRoot, "extensions/pstack/skill-catalog.test.ts");
		writeIfChanged(dest, patchCatalogCounts(readFileSync(dest, "utf8"), counts));
		return;
	}
	if (kind === "readme-counts") {
		const dest = join(destRoot, "README.md");
		writeIfChanged(dest, patchReadmeCounts(readFileSync(dest, "utf8"), counts));
		return;
	}
	if (kind === "drop-how-critics") {
		const configPath = join(destRoot, "extensions/pstack/config.ts");
		writeIfChanged(configPath, dropHowCriticsFromConfig(readFileSync(configPath, "utf8")));
		const testPath = join(destRoot, "extensions/pstack/config.test.ts");
		writeIfChanged(testPath, readFileSync(testPath, "utf8").replaceAll("how critics", "arena runners"));
		const setupPath = join(destRoot, "skills/setup-pstack/SKILL.md");
		writeIfChanged(setupPath, dropHowCriticsFromSetup(readFileSync(setupPath, "utf8")));
	}
}

export function apply(planned) {
	refreshSkillNames(planned.paths.from, planned.paths.to);
	for (const action of planned.actions) {
		if (action.kind === "skip") continue;
		if (action.kind === "write") {
			writeIfChanged(
				action.dest,
				renderWrite(action, planned.paths),
				join(planned.paths.from, action.rel),
			);
			continue;
		}
		if (action.kind === "delete") {
			if (existsSync(action.dest)) unlinkSync(action.dest);
			continue;
		}
		if (action.kind === "patch") {
			applyDerivedPatch(action.derived, planned.paths.to, planned.counts);
		}
	}
}

export function assertNoCursorSeams(destRoot) {
	const skillsRoot = join(destRoot, "skills");
	const rels = walkFiles(skillsRoot).map((rel) => asRelPath(`skills/${rel}`));
	const leftover = [];
	for (const rel of rels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only" || fileClass === "never-copy") continue;
		const text = readFileSync(join(destRoot, rel), "utf8");
		if (text.includes("AskQuestion")) leftover.push(`${rel}: AskQuestion`);
		if (text.includes("subagent_type")) leftover.push(`${rel}: subagent_type`);
		if (text.includes("~/.cursor/rules/pstack-models.mdc")) leftover.push(`${rel}: pstack-models.mdc`);
		if (text.includes("cursor-team-kit")) leftover.push(`${rel}: cursor-team-kit`);
		if (text.includes("<<<<<<<")) leftover.push(`${rel}: merge marker`);
		if (text.includes("Task subagent")) leftover.push(`${rel}: Task subagent`);
		if (text.includes("$HOME/.cursor")) leftover.push(`${rel}: $HOME/.cursor`);
		if (text.includes("@cursor-skill")) leftover.push(`${rel}: @cursor-skill`);
		if (/from \./.test(text)) leftover.push(`${rel}: from .`);
		const parts = rel.split("/");
		if (parts[parts.length - 1] !== "SKILL.md") continue;
		const skillDir = parts[1];
		const close = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
		const fm = close === -1 ? "" : text.slice(4, close);
		const hidden = /^disable-model-invocation:\s*true\s*$/m.test(fm);
		if (DISCOVERABLE.includes(skillDir)) {
			if (/^disable-model-invocation\s*:/m.test(fm)) {
				leftover.push(`${rel}: Discoverable skill must omit disable-model-invocation`);
			}
		} else if (!hidden) {
			leftover.push(`${rel}: Hidden skill missing disable-model-invocation`);
		}
	}
	if (leftover.length) {
		throw new Error(`cursor seams remain:\n${leftover.join("\n")}`);
	}
}

export function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const planned = plan(args);
	if (args.dryRun) {
		printPlan(planned);
		return;
	}
	apply(planned);
	assertNoCursorSeams(args.to);
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	}
}
