import { existsSync } from "node:fs";

export type Risk = {
	action: string;
	command?: string;
	reason?: string;
	severity: "destructive" | "risky";
};

export function formatRisk(risk: Risk): string {
	const lines = [`ACTION: ${risk.action}`];
	if (risk.command) lines.push(`COMMAND: \`${risk.command}\``);
	if (risk.reason) lines.push(`REASON: ${risk.reason}`);
	return lines.join("\n");
}

function shellWords(command: string): string[] {
	return command
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

/** Match a git subcommand even when global options sit between git and it. */
function hasGitSubcommand(words: readonly string[], subcommand: string): boolean {
	const index = words.indexOf("git");
	return index >= 0 && words.slice(index + 1).includes(subcommand);
}

/** Short-flag cluster containing any of the given letters (e.g. -rf, -fr). */
function hasShortFlagCluster(words: readonly string[], letters: string): boolean {
	return words.some((word) => /^-[a-z]+$/i.test(word) && [...word.slice(1).toLowerCase()].some((ch) => letters.includes(ch)));
}

export function classifyBash(command: string): Risk | undefined {
	const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
	const words = shellWords(normalized);

	if (hasGitSubcommand(words, "push") && /(^|\s)(--force|-f|--force-with-lease)(\s|$)/.test(normalized)) {
		return {
			action: "Force push git history",
			command,
			reason: "Force pushes can overwrite remote history for other collaborators.",
			severity: "destructive",
		};
	}

	if (hasGitSubcommand(words, "commit") && words.includes("--amend")) {
		return {
			action: "Amend the latest git commit",
			command,
			reason: "Amending rewrites local commit history.",
			severity: "destructive",
		};
	}

	if (hasGitSubcommand(words, "reset") && words.includes("--hard")) {
		return {
			action: "Hard reset git working tree",
			command,
			reason: "A hard reset discards uncommitted local changes.",
			severity: "destructive",
		};
	}

	if (hasGitSubcommand(words, "rebase") || hasGitSubcommand(words, "filter-branch")) {
		return {
			action: "Rewrite git history",
			command,
			reason: "This git operation can rewrite commit history.",
			severity: "destructive",
		};
	}

	if (
		(hasGitSubcommand(words, "branch") || hasGitSubcommand(words, "tag")) &&
		words.some((word) => word === "-d" || word === "-D")
	) {
		return {
			action: "Delete git branch or tag",
			command,
			reason: "Deleting refs can remove useful recovery points.",
			severity: "destructive",
		};
	}

	if (hasGitSubcommand(words, "push") && /(:refs\/|--delete)/.test(normalized)) {
		return {
			action: "Delete git branch or tag",
			command,
			reason: "Deleting refs can remove useful recovery points.",
			severity: "destructive",
		};
	}

	const rmIndex = words.lastIndexOf("rm");
	if (
		(rmIndex >= 0 &&
			words
				.slice(rmIndex + 1)
				.some((word) => /^(--recursive|--force)$/.test(word) || /^-[a-z]*[rRf]/i.test(word))) ||
		/\bfind\b[\s\S]*\s-delete\b/i.test(normalized)
	) {
		return {
			action: "Delete files or directories",
			command,
			reason: "The command removes data from the filesystem.",
			severity: "destructive",
		};
	}

	if (/\b(truncate|shred)\b/i.test(normalized) || />\s*[^&\s][^\n]*(\.env|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.json|\.ts|\.tsx|\.js|\.jsx|\.py|\.rs|\.go)\b/i.test(normalized)) {
		return {
			action: "Overwrite or erase file contents",
			command,
			reason: "The command may replace existing file contents.",
			severity: "destructive",
		};
	}

	if (/\b(sudo\s+)?(apt|apt-get|dnf|yum|pacman|brew)\s+(remove|purge|uninstall|autoremove)\b/i.test(normalized)) {
		return {
			action: "Remove system packages",
			command,
			reason: "Package removal can change the host system outside the project.",
			severity: "destructive",
		};
	}

	if (/\b(sudo\s+)?(systemctl|service)\s+(stop|disable|restart)\b/i.test(normalized)) {
		return {
			action: "Change system service state",
			command,
			reason: "Service changes can disrupt running system processes.",
			severity: "risky",
		};
	}

	if (words.includes("sudo")) {
		return {
			action: "Run a privileged system command",
			command,
			reason: "sudo commands can modify system-level state.",
			severity: "risky",
		};
	}

	return undefined;
}

export function classifyFileTool(toolName: string, input: Record<string, unknown>, inGitRepo: boolean): Risk | undefined {
	const rawPath = typeof input.path === "string" ? input.path : undefined;
	if (!rawPath) return undefined;
	const path = rawPath.replace(/\\/g, "/");

	if (
		/(^|\/)\.env(rc)?($|\.)/.test(path) ||
		/(^|\/)\.git(\/|$)/.test(path) ||
		/(^|\/)node_modules(\/|$)/.test(path) ||
		/(^|\/)\.(ssh|aws|gnupg|kube)(\/|$)/.test(path) ||
		/(^|\/)\.config\/(gcloud|gh)(\/|$)/.test(path)
	) {
		return {
			action: `Modify protected path ${path}`,
			reason: "Protected paths often contain secrets, git internals, or dependency artifacts.",
			severity: "destructive",
		};
	}

	if (inGitRepo) return undefined;

	if (toolName === "write" && existsSync(path)) {
		return {
			action: `Overwrite existing file ${path}`,
			reason: "This file is not protected by a detected git recovery point.",
			severity: "destructive",
		};
	}

	if (toolName === "edit") {
		const edits = Array.isArray(input.edits) ? input.edits.length : 1;
		if (edits >= 3) {
			return {
				action: `Apply ${edits} edits to ${path}`,
				reason: "Large-scale edits outside a detected git repo are harder to recover.",
				severity: "risky",
			};
		}
	}

	return undefined;
}

/**
 * Destructive risks always go through UI confirmation - pasted logs, fetched
 * pages, or injected text in the user message must never auto-allow them.
 * Only risky-severity system changes can be pre-approved by explicit wording.
 */
export function userExplicitlyRequestedRisk(userText: string, risk: Risk): boolean {
	if (risk.severity === "destructive") return false;
	const text = userText.toLowerCase();
	if (!text) return false;

	const explicitSystemVerb = /\b(sudo|system|service|package|uninstall|disable|stop|restart)\b/i.test(text);
	if (!explicitSystemVerb) return false;

	return risk.action.toLowerCase().includes("system");
}

/** Short system-prompt block appended when Safety Guard is enabled. */
export function safetyPrompt(): string {
	return (
		"\n\nSafety Guard is on. Before any destructive action the user did not explicitly request, " +
		"ask with ask_user_question using:\n" +
		"ACTION: short description\n" +
		"COMMAND (if any): `...`\n" +
		"REASON (if any): one line\n" +
		"Do not over-ask: normal recoverable edits in git repos are fine. " +
		"Destructive = deletes, large unrecoverable edits, system changes, history rewrite/amend, force-push. " +
		"Coalesce related confirms."
	);
}
