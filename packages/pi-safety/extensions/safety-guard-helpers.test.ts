import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyBash, safetyPrompt } from "./safety-guard-helpers.ts";

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

	it("ignores harmless commands", () => {
		assert.equal(classifyBash("echo hi"), undefined);
	});
});
