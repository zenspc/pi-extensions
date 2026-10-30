import { posix } from "node:path";

export function patchRuntimeInstructions(text, rel) {
	if (rel === "skills/poteto-mode/references/pi-runtime.md") return text;
	const reference = posix.relative(posix.dirname(rel), "skills/poteto-mode/references/pi-runtime.md");
	const link = `[Pi runtime prerequisites](${reference})`;
	if (rel === "skills/reflect/SKILL.md") {
		text = text.replace(/Before fanning out, find this conversation's transcript[\s\S]*?(?=\n## 2\.)/,
			`Before fanning out, locate the active Pi session or retained pi-subagents run through ${link}.\nUse only the verified workspace-scoped file or a bounded digest when it is unavailable.\n`);
	}
	if (rel === "skills/automate-me/SKILL.md") {
		text = text.replace(/Locate the active workspace's transcripts[^\n]*/,
			`Locate workspace-scoped Pi sessions and retained pi-subagents runs through ${link}.\nPass only verified exact paths to mining subagents; if history is unavailable, use the visible conversation and name that limit.`);
	}
	if (rel === "skills/show-me-your-work/SKILL.md") {
		text = text.replace(/Read this run's transcript under[^\n]*?That reads unrelated private chats\./,
			`Locate this run's Pi session or retained pi-subagents record through ${link}.\nIf it is unavailable, name the missing evidence rather than claiming the transcript audit passed.\n`);
	}
	if (rel === "skills/poteto-mode/playbooks/eval.md") {
		text = text.replace(/Read each candidate's local transcript under[^\n]*?That crosses workspace boundaries and reads private chats from unrelated projects\./,
			`Read each candidate's exact retained pi-subagents session through ${link}, verifying its workspace or assigned worktree first.\n   If a transcript is missing, mark chain-following unverified.`);
	}
	if (rel === "skills/poteto-mode/playbooks/session-pickup.md") {
		text = text.replace(/A local transcript under[^\n]*?(?= Read the metadata overview)/,
			`Use ${link} to locate a workspace-verified Pi session, a retained pi-subagents run record, or a pushed branch.`);
	}
	if (rel === "skills/poteto-mode/playbooks/autonomous-run.md") {
		text = text.replace(/^2\. Pick the wake mechanism[^\n]*/m,
			`2. Select and test a scheduler or watcher through ${link} before promising unattended continuation.\n   Prefer event delivery when waiting on CI, a merge, or a ref; otherwise use a verified fixed-interval schedule.\n   Without one, work while this session is active, then checkpoint external waits and report the missing capability.`);
	}
	text = text
		.replace(/On the operator's go, arm `a recurring 1-hour wake` to audit until no delegated work is left/, "On the operator's go, use a verified scheduler for an hourly audit until no delegated work is left; without one, audit at active-session checkpoints and report that unattended audits are unavailable")
		.replace(/On the operator's go, arm the audit tick as `a recurring 1-hour wake` with the tick prompt below\. Never leave the cadence to memory\./, "On the operator's go, verify a 1-hour scheduler using the Pi runtime prerequisites and record its run ID and cancellation method. Without one, use the tick prompt at active-session checkpoints and report that unattended audits are unavailable.")
		.replace("Run `drive` and `background` under a recurring wake in dynamic mode.", "Run `drive` and `background` with verified watcher delivery per the Pi runtime prerequisites, or checkpoint the wait and report that unattended continuation is unavailable.")
		.replace("under a recurring wake until it reports", "with verified watcher delivery per the Pi runtime prerequisites until it reports")
		.replace("a recurring wake per component until the diff is zero.", "Repeat checks per component while the session is active until the diff is zero; unattended iterations require verified delivery per the Pi runtime prerequisites.")
		.replace("Drive a long or stubborn hunt with a recurring wake.", "For an unattended hunt, verify wake delivery per the Pi runtime prerequisites; otherwise continue in the active session and checkpoint external waits.")
		.replace("current agent's store (path in the system prompt)", "task-scoped artifact directory recorded per the Pi runtime prerequisites")
		.replace("root agent's store (path in the system prompt)", "root's task-scoped artifact directory")
		.replace("the agent store's `docs/`", "the task-scoped artifact directory's `docs/` (see the Pi runtime prerequisites)");

	const needsRuntime = /recurring[^\n]*wake|watcher wake|hourly (?:audit|scheduler)|Pi runtime prerequisites|task-scoped artifact directory/.test(text);
	if (needsRuntime && !text.includes(link)) {
		text = text.replace(/^(#{1,6} .+\n)/m, `$1\nRead ${link} before scheduling work or locating transcripts and durable artifacts.\n`);
	}
	return text;
}

export function patchModelInstructions(text, rel) {
	if (!["skills/arena/SKILL.md", "skills/interrogate/SKILL.md", "skills/architect/SKILL.md"].includes(rel)) return text;
	const reference = posix.relative(posix.dirname(rel), "skills/poteto-mode/references/pi-models.md");
	const link = `[Pi review models](${reference})`;
	text = text
		.replace("The adversarial signal comes from model diversity, not assigned personas.", "Different model families can expose different blind spots; default parent-model reviewers provide repeated samples, not model diversity.")
		.replace(/If the subagent tool rejects a configured entry,[^\n]+?(?= Spawn more runners)/, "For unavailable or rejected selectors, follow the Pi review-model fallback contract.")
		.replace(/^If the subagent tool rejects a configured entry,[^\n]+/m, "For unavailable or rejected selectors, follow the Pi review-model fallback contract and report the models that actually ran.")
		.replace("default to one each on inherit-parent and inherit-parent", "default to two parent-model candidates")
		.replace("choose from inherit-parent and inherit-parent. Prefer a different model family from the parent's.", "use the parent model. Prefer a different model family only within the configured, available pool; otherwise label it a same-model judge.");
	if (!text.includes(link)) {
		text = text.replace(/^(# .+\n)/m, `$1\nRead ${link} before launching; report effective models and label same-model panels accurately.\n`);
	}
	return text;
}

export function runtimeInstructionIssues(text, rel) {
	const issues = [];
	if (/agent-transcripts\/|<agent-transcripts>/.test(text)) issues.push("unsupported transcript discovery");
	if (/\bcloud-agent URL\b/.test(text)) issues.push("unsupported cloud-agent trail");
	if (/Families go by prefix:/.test(text)) issues.push("Cursor-prefix model fallback");
	if (["skills/arena/SKILL.md", "skills/interrogate/SKILL.md", "skills/architect/SKILL.md"].includes(rel)
		&& !text.includes("references/pi-models.md")) issues.push("missing effective model/diversity contract");
	if (/recurring wake[^\n]*\(a built-in/.test(text)) issues.push("claims built-in recurring wakes");
	if (/arm(?: the audit tick as)? `a recurring 1-hour wake`/.test(text)) issues.push("unconditional hourly wake");
	if (/store \(path in the system prompt\)/.test(text)) issues.push("assumes an injected agent store");
	if (rel.startsWith("skills/poteto-mode/playbooks/") && /recurring[^\n]*wake|watcher delivery|hourly (?:audit|scheduler)/.test(text)
		&& !text.includes("references/pi-runtime.md")) issues.push("missing scheduler capability contract");
	return issues;
}
