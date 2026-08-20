import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCopilotBaseUrl } from "./models.ts";

test("rewrites proxy-ep host from proxy.X to api.X", () => {
	assert.equal(
		resolveCopilotBaseUrl("tid=1;proxy-ep=proxy.enterprise.githubcopilot.com;exp=1"),
		"https://api.enterprise.githubcopilot.com",
	);
});

test("falls back to copilot-api.<enterprise host> when token has no proxy-ep", () => {
	assert.equal(
		resolveCopilotBaseUrl("tid=1;exp=1", "company.ghe.com"),
		"https://copilot-api.company.ghe.com",
	);
});

test("falls back to individual host when token has no proxy-ep and no enterpriseUrl", () => {
	assert.equal(
		resolveCopilotBaseUrl("tid=1;exp=1"),
		"https://api.individual.githubcopilot.com",
	);
});

test("enterpriseUrl with scheme and path uses hostname only", () => {
	assert.equal(
		resolveCopilotBaseUrl("tid=1;exp=1", "https://company.ghe.com/foo"),
		"https://copilot-api.company.ghe.com",
	);
});
