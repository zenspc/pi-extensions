import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { expandSkillReferences } from "../../extensions/multi-skill.ts";

function skill(name: string, path: string): SlashCommandInfo {
	return {
		name: `skill:${name}`,
		source: "skill",
		sourceInfo: { path, source: "test", scope: "temporary", origin: "top-level" },
	};
}

function fixture(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), "pi-multi-skill-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const commands = ["first", "second"].map((name) => {
		const path = join(dir, "skills", name, "SKILL.md");
		mkdirSync(join(dir, "skills", name), { recursive: true });
		writeFileSync(path, `---\nname: ${name}\ndescription: Test ${name}\n---\n\n# ${name}\nFollow ${name}.`);
		return skill(name, path);
	});
	return { dir, commands };
}

test("loads multiple skills once in mention order and preserves the entire request", async (t) => {
	const { commands } = fixture(t);
	const request = "/second do this\nwith /skill:first, then /skill:second";
	const expanded = await expandSkillReferences(request, commands);
	assert.ok(expanded);
	assert.ok(expanded.indexOf('<skill name="second"') < expanded.indexOf('<skill name="first"'));
	assert.equal(expanded.match(/<skill /g)?.length, 2);
	assert.ok(expanded.endsWith(request));
	assert.ok(expanded.includes(`location="${commands[0].sourceInfo.path}"`));
	assert.ok(expanded.includes(`References are relative to ${dirname(commands[0].sourceInfo.path)}.`));
	assert.ok(expanded.includes("Follow first.\n</skill>"));
	assert.ok(!expanded.includes("description: Test"));
});

test("ignores unknown names, code, escaped references, URLs, and paths", async (t) => {
	const { commands } = fixture(t);
	for (const text of [
		"ordinary text /missing /skill:missing",
		"`/first` and ``/skill:second``",
		"```text\n/first\n/skill:second\n```",
		"~~~text\n/first\n~~~",
		"https://example.com/first /first/file /skill:first/file \\/first ./second",
	]) {
		assert.equal(await expandSkillReferences(text, commands), undefined, text);
	}
	assert.match((await expandSkillReferences("`/first` but use /second.", commands)) ?? "", /<skill name="second"/);
});

test("keeps extension/template names reserved and leading commands untouched", async (t) => {
	const { commands } = fixture(t);
	for (const source of ["extension", "prompt"] satisfies SlashCommandInfo["source"][]) {
		const reserved: SlashCommandInfo = { ...commands[0], name: "first", source };
		const registry = [...commands, reserved];
		assert.equal(await expandSkillReferences("/first with /second", registry), undefined);
		assert.equal(await expandSkillReferences("use /first", registry), undefined);
		assert.match((await expandSkillReferences("use /skill:first", registry)) ?? "", /<skill name="first"/);
	}
});

test("rejects unreadable skills without returning a partial expansion", async (t) => {
	const { commands } = fixture(t);
	rmSync(commands[1].sourceInfo.path);
	await assert.rejects(expandSkillReferences("/first with /second", commands), /Cannot load \/skill:second/);
});

test("escapes skill location attributes and reads fresh contents", async (t) => {
	const { dir } = fixture(t);
	const path = join(dir, 'a"&<.md');
	writeFileSync(path, "First body");
	const commands = [skill("fresh", path)];
	assert.match((await expandSkillReferences("use /fresh", commands)) ?? "", /a&quot;&amp;&lt;\.md/);
	writeFileSync(path, "Updated body");
	assert.match((await expandSkillReferences("use /fresh", commands)) ?? "", /Updated body/);
});

test("Pi loads inline autocomplete and transforms interactive/RPC input without losing images", async (t) => {
	const { dir } = fixture(t);
	const agentDir = join(dir, "agent");
	mkdirSync(agentDir);
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: [resolve("packages/pi-devtools/extensions/multi-skill.ts")],
		additionalSkillPaths: [join(dir, "skills")],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert.equal(loader.getSkills().skills.length, 2);
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(dir),
		tools: [],
	});
	t.after(() => session.dispose());
	const errors: unknown[] = [];
	session.extensionRunner.onError((error) => errors.push(error));
	let provider: AutocompleteProvider = new CombinedAutocompleteProvider(
		loader.getSkills().skills.map((skill) => ({ name: `skill:${skill.name}` })), dir,
	);
	session.extensionRunner.setUIContext({
		...session.extensionRunner.getUIContext(),
		addAutocompleteProvider(factory) { provider = factory(provider); },
	}, "tui");
	await session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	const screenshotInput = "/skill:improve this repo with /";
	const suggestions = await provider.getSuggestions([screenshotInput], 0, screenshotInput.length, { signal: new AbortController().signal });
	assert.ok(suggestions?.items.some((item) => item.value === "/skill:second"), "The second slash should suggest loaded skills");
	assert.equal(suggestions.prefix, "/");
	const item = suggestions.items.find((item) => item.value === "/skill:second");
	assert.ok(item);
	const completed = provider.applyCompletion([screenshotInput], 0, screenshotInput.length, item, suggestions.prefix);
	assert.equal(completed.lines[0], "/skill:improve this repo with /skill:second ");
	assert.equal(completed.cursorCol, completed.lines[0].length);
	assert.ok(provider.triggerCharacters?.includes("/"), "Typing slash must trigger suggestions without pressing Tab");
	const options = { signal: new AbortController().signal };
	for (const token of ["/sec", "/skill:sec"]) {
		const line = `/skill:first with ${token}`;
		const filtered = await provider.getSuggestions([line], 0, line.length, options);
		assert.deepEqual(filtered?.items.map((item) => item.value), ["/skill:second"]);
	}
	const multiLine = ["/skill:first", "with /sec after this"];
	const partial = await provider.getSuggestions(multiLine, 1, 9, options);
	assert.ok(partial);
	const multiLineCompletion = provider.applyCompletion(multiLine, 1, 9, item, partial.prefix);
	assert.deepEqual(multiLineCompletion.lines, ["/skill:first", "with /skill:second after this"]);
	assert.equal(multiLineCompletion.cursorCol, "with /skill:second".length);
	const firstCommand = await provider.getSuggestions(["/skill:f"], 0, 8, options);
	assert.ok(firstCommand?.items.some((item) => item.value === "skill:first"), "Initial command completion must stay native");
	for (const code of ["`text /", "```text\nwith /", "~~~text\nwith /"]) {
		const lines = code.split("\n");
		const line = lines.length - 1;
		const result = await provider.getSuggestions(lines, line, lines[line].length, options);
		assert.ok(!result?.items.some((item) => item.value.startsWith("/skill:")), "Do not suggest inline skills inside code");
	}
	const images = [{ type: "image", data: "test", mimeType: "image/png" } satisfies import("@earendil-works/pi-ai").ImageContent];
	for (const source of ["interactive", "rpc"] as const) {
		const result = await session.extensionRunner.emitInput("/first with /skill:second", images, source, "steer");
		assert.equal(result.action, "transform");
		if (result.action !== "transform") throw new Error("Expected transformed input");
		assert.match(result.text, /<skill name="first"/);
		assert.match(result.text, /<skill name="second"/);
		assert.deepEqual(result.images, images);
	}
	assert.equal((await session.extensionRunner.emitInput("/first with /second", undefined, "extension")).action, "continue");
	assert.equal((await session.extensionRunner.emitInput("ordinary text", undefined, "rpc")).action, "continue");
	rmSync(join(dir, "skills", "second", "SKILL.md"));
	assert.equal((await session.extensionRunner.emitInput("/first with /second", undefined, "rpc")).action, "handled");
	assert.deepEqual(errors, []);
});
