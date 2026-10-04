import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	createQuietBashToolDefinitionFactory,
	loadBashToolSettings,
	mergeBashToolSettings,
	parseBashToolSettings,
} from "./bash-settings.ts";

const temps: string[] = [];

afterEach(() => {
	while (temps.length) {
		const dir = temps.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-quiet-bash-"));
	temps.push(dir);
	return dir;
}

describe("parseBashToolSettings", () => {
	it("returns empty for invalid shapes", () => {
		assert.deepEqual(parseBashToolSettings(null), {});
		assert.deepEqual(parseBashToolSettings("x"), {});
		assert.deepEqual(parseBashToolSettings([]), {});
		assert.deepEqual(parseBashToolSettings({ shellPath: 1 }), {});
	});

	it("reads shellPath and shellCommandPrefix", () => {
		assert.deepEqual(
			parseBashToolSettings({
				shellPath: String.raw`D:\Program Files\Git\bin\bash.exe`,
				shellCommandPrefix: "export FOO=1",
			}),
			{
				shellPath: String.raw`D:\Program Files\Git\bin\bash.exe`,
				commandPrefix: "export FOO=1",
			},
		);
	});

	it("expands leading tilde in shellPath", () => {
		const home = () => "/home/rey";
		assert.equal(
			parseBashToolSettings({ shellPath: "~/bin/bash" }, home).shellPath,
			join("/home/rey", "bin/bash"),
		);
	});

	it("ignores blank shellPath", () => {
		assert.deepEqual(parseBashToolSettings({ shellPath: "   " }), {});
	});
});

describe("mergeBashToolSettings", () => {
	it("lets project override global per field", () => {
		assert.deepEqual(
			mergeBashToolSettings(
				{ shellPath: "/global/bash", commandPrefix: "g" },
				{ shellPath: "/project/bash" },
			),
			{ shellPath: "/project/bash", commandPrefix: "g" },
		);
	});
});

describe("loadBashToolSettings", () => {
	it("loads global shellPath used by Windows non-default Git installs", () => {
		const agentDir = tempDir();
		const cwd = tempDir();
		const shellPath = String.raw`D:\Program Files\Git\bin\bash.exe`;
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ shellPath }),
			"utf8",
		);

		assert.deepEqual(loadBashToolSettings(cwd, agentDir), { shellPath });
	});

	it("merges project settings over global", () => {
		const agentDir = tempDir();
		const cwd = tempDir();
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				shellPath: "/global/bash",
				shellCommandPrefix: "export G=1",
			}),
			"utf8",
		);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({ shellPath: "/project/bash" }),
			"utf8",
		);

		assert.deepEqual(loadBashToolSettings(cwd, agentDir), {
			shellPath: "/project/bash",
			commandPrefix: "export G=1",
		});
	});

	it("returns empty when settings are missing", () => {
		const agentDir = tempDir();
		const cwd = tempDir();
		assert.deepEqual(loadBashToolSettings(cwd, agentDir), {});
	});
});

describe("createQuietBashToolDefinitionFactory", () => {
	it("passes shellPath into createBash (regression for gh #37)", () => {
		const shellPath = String.raw`D:\Program Files\Git\bin\bash.exe`;
		let captured: { cwd?: string; options?: unknown } = {};
		const create = createQuietBashToolDefinitionFactory(
			(cwd, options) => {
				captured = { cwd, options };
				return { name: "bash" };
			},
			() => ({ shellPath, commandPrefix: "export FOO=1" }),
		);

		const def = create("/work");
		assert.equal(def.name, "bash");
		assert.equal(captured.cwd, "/work");
		assert.deepEqual(captured.options, {
			shellPath,
			commandPrefix: "export FOO=1",
		});
	});

	it("does not call createBash with bare cwd-only options when settings exist", () => {
		const create = createQuietBashToolDefinitionFactory(
			(_cwd, options) => {
				assert.ok(options);
				assert.equal(typeof options.shellPath, "string");
				return { name: "bash" };
			},
			() => ({ shellPath: "/custom/bash" }),
		);
		create("/work");
	});
});
