import { existsSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "./process.ts";
import { atomicJson, readJson, type Store } from "./state.ts";
import { ModelsSchema, tiers, validate, type Models, type Tier } from "./schema.ts";

export function parseModelList(output: string): string[] {
	const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
	const ids: string[] = [];
	for (const line of clean.split("\n")) {
		const columns = line.trim().split(/\s+/);
		if (columns.length >= 6 && /^\d/.test(columns[2]) && ["yes", "no"].includes(columns[4])) {
			ids.push(`${columns[0]}/${columns[1]}`);
		}
	}
	return [...new Set(ids)];
}

export async function discoverModels(store: Store, binary = "pi"): Promise<Models> {
	const result = await runProcess(binary, ["--list-models", "--no-extensions", "--no-mcp", "--no-skills"], {
		cwd: store.root, durationMs: 60_000, inactivityMs: 60_000, outputLimit: 4 * 1024 * 1024, failOnOverflow: true,
	});
	if (result.code) throw new Error(result.stderr || "pi --list-models failed");
	const available = parseModelList(result.output);
	if (!available.length) throw new Error("No authenticated models discovered. Log in with Pi before starting autopilot");
	const path = join(store.dir, "models.json");
	const old = existsSync(path) ? validate(ModelsSchema, readJson(path)) : undefined;
	function ranked(tier: Tier): string[] {
		const pattern = tier === "deep" ? /opus|pro\b|gpt-5|o3|o4|deepseek-r/i
			: tier === "standard" ? /sonnet|gpt-5|pro\b/i : /haiku|mini|flash|small|fast/i;
		return [...available].sort((a, b) => Number(pattern.test(b)) - Number(pattern.test(a)) || a.localeCompare(b));
	}
	const routes = Object.fromEntries(tiers.map((tier) => {
		const order = ranked(tier);
		const primary = old && available.includes(old.tiers[tier].primary) ? old.tiers[tier].primary : order[0];
		const fallbacks = old ? old.tiers[tier].fallbacks.filter((id) => available.includes(id) && id !== primary)
			: order.filter((id) => id.split("/")[0] !== primary.split("/")[0])
				.filter((id, i, all) => all.findIndex((other) => other.split("/")[0] === id.split("/")[0]) === i).slice(0, 3);
		return [tier, { primary, fallbacks }];
	}));
	const models = validate(ModelsSchema, { version: 1, discoveredAt: new Date().toISOString(), available, tiers: routes });
	atomicJson(path, models);
	return models;
}

export function candidates(models: Models, tier: Tier, assigned?: string): string[] {
	const route = models.tiers[tier];
	const ids = [...new Set([assigned ?? route.primary, route.primary, ...route.fallbacks])];
	if (ids.some((id) => !models.available.includes(id))) throw new Error("Configured route contains an undiscovered model");
	return ids;
}
