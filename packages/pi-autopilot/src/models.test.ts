import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import { thinkingLevels, tiers } from "./schema.ts";
import { atomicJson, Store } from "./state.ts";
import { models } from "./test-support.ts";

test("/autopilot-models selects tier models and thinking levels and saves only completed selections", async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "autopilot-models-")));
	const previousPath = process.env.PATH;
	const store = new Store(root);
	const path = join(store.dir, "models.json");
	const binary = join(root, "pi");
	const catalog = "provider model context max-out thinking images\ncheap fast 200K 16K no yes\nfrontier deep 1M 64K yes yes\nbackup fast 200K 16K yes yes\n";
	const metadata: NonNullable<ReturnType<ExtensionCommandContext["modelRegistry"]["find"]>>[] = models.available.map((id) => ({
		provider: id.split("/")[0], id: id.split("/")[1], name: id, api: "openai-responses", baseUrl: "https://example.invalid",
		reasoning: id !== "cheap/fast", input: ["text"], contextWindow: 200_000, maxTokens: 16_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		thinkingLevelMap: id === "frontier/deep" ? { minimal: null, xhigh: "xhigh", max: "max" } : undefined,
	}));
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const notices: string[] = [];
	const prompts: { title: string; options: string[] }[] = [];
	let choices: (string | undefined)[] = [];
	let hasUI = true, hasMetadata = true;
	const api = {
		registerCommand: (name: string, value: Parameters<ExtensionAPI["registerCommand"]>[1]) => commands.set(name, value),
		registerTool: () => {}, on: () => {},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: root, mode: "rpc", get hasUI() { return hasUI; },
		modelRegistry: { find: (provider: string, id: string) => hasMetadata ? metadata.find((model) => model.provider === provider && model.id === id) : undefined },
		ui: {
			notify: (message: string) => notices.push(message),
			select: async (title: string, options: string[]) => {
				prompts.push({ title, options });
				return choices.shift();
			},
		},
	} as unknown as ExtensionCommandContext;
	try {
		writeFileSync(binary, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(catalog)});\n`, { mode: 0o700 });
		process.env.PATH = `${root}:${previousPath ?? ""}`;
		extension(api);
		const command = commands.get("autopilot-models");
		assert.ok(command);
		const run = async (selected: (string | undefined)[]) => {
			choices = [...selected]; prompts.length = 0; notices.length = 0;
			await command.handler("", ctx);
			assert.equal(existsSync(join(store.dir, "lock.json")), false, "always release the repository lock");
		};

		await t.test("first-run thinking cancellation creates no configuration", async () => {
			await run(["frontier/deep", undefined]);
			assert.equal(prompts.length, 2);
			assert.match(prompts[1].title, /Thinking level for scout/);
			assert.equal(existsSync(path), false);
			assert.match(notices[0], /cancelled/);
		});

		await t.test("all tiers offer authenticated models and only supported thinking levels", async () => {
			atomicJson(path, models);
			const selected = ["backup/fast", "frontier/deep", "cheap/fast", "backup/fast", "frontier/deep"];
			const thinking = ["medium", "max", "off", "high", "xhigh"];
			await run(selected.flatMap((model, index) => [model, thinking[index]]));
			assert.equal(prompts.length, 10);
			const saved = store.models();
			assert.deepEqual(saved.available, models.available);
			for (const [index, tier] of tiers.entries()) {
				const picker = prompts[index * 2];
				assert.equal(picker.title, `Model for ${tier} (current: ${models.tiers[tier].primary})`);
				assert.equal(picker.options[0], models.tiers[tier].primary);
				assert.deepEqual([...picker.options].sort(), [...models.available].sort());
				assert.equal(prompts[index * 2 + 1].title, `Thinking level for ${tier} (${selected[index]})`);
				assert.equal(saved.tiers[tier].primary, selected[index]);
				assert.equal(saved.tiers[tier].thinkingLevel, thinking[index]);
				assert.deepEqual(saved.tiers[tier].fallbacks, models.tiers[tier].fallbacks.filter((id) => id !== selected[index]));
			}
			assert.deepEqual(prompts[1].options, ["low", "off", "minimal", "medium", "high"]);
			assert.deepEqual(prompts[3].options, ["low", "off", "medium", "high", "xhigh", "max"]);
			assert.deepEqual(prompts[5].options, ["off"], "non-reasoning models only support off");
			assert.equal(prompts[7].options[0], "high", "deep defaults to high");
			assert.match(notices[0], /Selected models saved/);
		});

		await t.test("rediscovery preserves configured thinking and cancelling leaves the file unchanged", async () => {
			const before = readFileSync(path, "utf8");
			await run(["frontier/deep", undefined]);
			assert.equal(prompts[1].options[0], "medium");
			assert.equal(readFileSync(path, "utf8"), before);
			await run(["backup/fast", "medium", "backup/fast", undefined]);
			assert.equal(prompts[3].options[0], "high", "clamp the saved max level when switching to a less capable model");
			assert.equal(readFileSync(path, "utf8"), before);
			await run(["cheap/fast", "off", "cheap/fast", "off", "backup/fast", "high", "frontier/deep", "max", "frontier/deep", undefined]);
			assert.equal(prompts.length, 10);
			assert.equal(readFileSync(path, "utf8"), before);
			assert.match(notices[0], /cancelled/);
			await run(["cheap/fast", "off", undefined]);
			assert.equal(prompts.length, 3);
			assert.equal(readFileSync(path, "utf8"), before);
		});

		await t.test("missing metadata still allows thinking selection, with Pi clamping at execution", async () => {
			hasMetadata = false;
			await run(["frontier/deep", undefined]);
			assert.deepEqual([...prompts[1].options].sort(), [...thinkingLevels].sort());
			hasMetadata = true;
		});

		await t.test("untrusted models or thinking levels and clients without a UI cannot overwrite configuration", async () => {
			const before = readFileSync(path, "utf8");
			await run(["unknown/model"]);
			assert.match(notices[0], /Undiscovered model/);
			await run(["frontier/deep", "minimal"]);
			assert.match(notices[0], /Unsupported thinking level/);
			await run(["cheap/fast", "high"]);
			assert.match(notices[0], /Unsupported thinking level/);
			assert.equal(readFileSync(path, "utf8"), before);
			hasUI = false;
			await run([]);
			assert.equal(prompts.length, 0);
			assert.match(notices[0], /with a UI/);
			assert.equal(readFileSync(path, "utf8"), before);
		});
	} finally {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		rmSync(root, { recursive: true, force: true });
	}
});
