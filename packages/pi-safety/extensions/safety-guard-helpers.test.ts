import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyBash,
	classifyFileTool,
	safetyPrompt,
	userExplicitlyRequestedRisk,
} from "./safety-guard-helpers.ts";

describe("safetyPrompt", () => {
	it("stays within the token budget", () => {
		assert.ok(safetyPrompt().length <= 420);
	});

	it("steers the model to ask with the template", () => {
		const prompt = safetyPrompt();
		assert.ok(prompt.includes("ask_user_question"));
		assert.ok(prompt.includes("ACTION:"));
		assert.ok(prompt.includes("COMMAND"));
		assert.ok(prompt.includes("REASON"));
	});

	it("covers force-push and not over-asking in git repos", () => {
		const prompt = safetyPrompt();
		assert.ok(/force-?push/i.test(prompt));
		assert.ok(/over-ask/i.test(prompt));
		assert.ok(/git/i.test(prompt));
	});
});

describe("classifyBash", () => {
	it("flags recursive deletes as destructive", () => {
		// Classifier matches -r/-f as separate flags (combined -rf is pre-existing gap).
		const risk = classifyBash("rm -r /tmp/x");
		assert.ok(risk);
		assert.equal(risk.severity, "destructive");
		assert.match(risk.action, /delete/i);
	});

	it("flags force pushes as destructive", () => {
		const risk = classifyBash("git push --force");
		assert.ok(risk);
		assert.equal(risk.severity, "destructive");
		assert.match(risk.action, /force push/i);
	});

	it("flags force pushes with global options between git and push", () => {
		const risk = classifyBash("git -C repo push --force origin main");
		assert.ok(risk);
		assert.match(risk.action, /force push/i);
	});

	it("flags combined short-flag deletes like rm -rf", () => {
		const risk = classifyBash("rm -rf /tmp/x");
		assert.ok(risk);
		assert.equal(risk.severity, "destructive");
	});

	it("flags hard reset with global options", () => {
		const risk = classifyBash("git --git-dir=.git reset --hard");
		assert.ok(risk);
		assert.match(risk.action, /hard reset/i);
	});

	it("ignores harmless commands", () => {
		assert.equal(classifyBash("echo hi"), undefined);
	});
});

describe("classifyFileTool", () => {
	it("flags .env files", () => {
		const risk = classifyFileTool("write", { path: "/app/.env" }, true);
		assert.ok(risk);
	});

	it("flags .envrc files", () => {
		const risk = classifyFileTool("write", { path: "/app/.envrc" }, true);
		assert.ok(risk);
	});

	it("flags Windows-style protected paths", () => {
		const risk = classifyFileTool("write", { path: "C:\\repo\\.env.local" }, true);
		assert.ok(risk);
	});

	it("flags credential directories", () => {
		for (const path of ["/home/u/.ssh/id_rsa", "/home/u/.aws/credentials", "/home/u/.config/gcloud/x"])
			assert.ok(classifyFileTool("write", { path }, false), path);
	});

	it("does not flag .environment or normal files", () => {
		assert.equal(classifyFileTool("write", { path: "/app/src/environment.ts" }, true), undefined);
		assert.equal(classifyFileTool("write", { path: "/app/src/new-file.ts" }, false), undefined);
	});
});

describe("userExplicitlyRequestedRisk", () => {
	it("never auto-allows destructive risks, even with matching command text", () => {
		const risk = { action: "Delete files or directories", command: "rm -rf node_modules", severity: "destructive" as const };
		const text = "please delete this failing build, I ran rm -rf node_modules earlier";
		assert.equal(userExplicitlyRequestedRisk(text, risk), false);
	});

	it("allows risky system changes when explicitly worded", () => {
		const risk = { action: "Change system service state", severity: "risky" as const };
		assert.equal(userExplicitlyRequestedRisk("stop the nginx service", risk), true);
	});

	it("does not auto-allow risky changes without explicit wording", () => {
		const risk = { action: "Change system service state", severity: "risky" as const };
		assert.equal(userExplicitlyRequestedRisk("fix the server please", risk), false);
	});

	it("returns false on empty user text", () => {
		const risk = { action: "Run a privileged system command", severity: "risky" as const };
		assert.equal(userExplicitlyRequestedRisk("", risk), false);
	});
});
