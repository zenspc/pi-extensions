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

export function classifyBash(command: string): Risk | undefined {
	const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
	const words = shellWords(normalized);

	if (/\bgit\s+push\b[\s\S]*(--force|-f|--force-with-lease)\b/i.test(normalized)) {
		return {
			action: "Force push git history",
			command,
			reason: "Force pushes can overwrite remote history for other collaborators.",
			severity: "destructive",
		};
	}

	if (/\bgit\s+commit\b[\s\S]*(--amend)\b/i.test(normalized)) {
		return {
			action: "Amend the latest git commit",
			command,
			reason: "Amending rewrites local commit history.",
			severity: "destructive",
		};
	}

	if (/\bgit\s+reset\b[\s\S]*(--hard)\b/i.test(normalized)) {
		return {
			action: "Hard reset git working tree",
			command,
			reason: "A hard reset discards uncommitted local changes.",
			severity: "destructive",
		};
	}

	if (/\bgit\s+(rebase|filter-branch)\b/i.test(normalized)) {
		return {
			action: "Rewrite git history",
			command,
			reason: "This git operation can rewrite commit history.",
			severity: "destructive",
		};
	}

	if (/\bgit\s+(branch|tag)\b[\s\S]*\s-d\b|\bgit\s+(branch|tag)\b[\s\S]*\s-D\b|\bgit\s+push\b[\s\S]*(:refs\/|--delete)\b/i.test(normalized)) {
		return {
			action: "Delete git branch or tag",
			command,
			reason: "Deleting refs can remove useful recovery points.",
			severity: "destructive",
		};
	}

	if (/\brm\b[\s\S]*(-r|-R|-f|--recursive|--force)\b/i.test(normalized) || /\bfind\b[\s\S]*\s-delete\b/i.test(normalized)) {
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
	const path = typeof input.path === "string" ? input.path : undefined;
	if (!path) return undefined;

	if (/(^|\/)\.env($|\.)|(^|\/)\.git(\/|$)|(^|\/)node_modules(\/|$)/.test(path)) {
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

export function userExplicitlyRequestedRisk(userText: string, risk: Risk): boolean {
	const text = userText.toLowerCase();
	if (!text) return false;

	const explicitDestructiveVerb = /\b(delete|remove|erase|wipe|purge|destroy|overwrite|replace|reset hard|hard reset|amend|rebase|force push|force-push|drop|truncate|shred|uninstall|disable|stop|restart)\b/i.test(text);
	if (!explicitDestructiveVerb) return false;

	if (risk.command && text.includes(risk.command.toLowerCase())) return true;

	const action = risk.action.toLowerCase();
	return (
		(action.includes("delete") && /\b(delete|remove|erase|wipe|purge)\b/i.test(text)) ||
		(action.includes("overwrite") && /\b(overwrite|replace)\b/i.test(text)) ||
		(action.includes("force push") && /\b(force push|force-push)\b/i.test(text)) ||
		(action.includes("amend") && /\bamend\b/i.test(text)) ||
		(action.includes("reset") && /\b(reset hard|hard reset)\b/i.test(text)) ||
		(action.includes("history") && /\b(rebase|rewrite history|amend)\b/i.test(text)) ||
		(action.includes("system") && /\b(sudo|system|service|package|uninstall|remove)\b/i.test(text))
	);
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
