/**
 * Static Copilot per-model pricing for pi session cost estimates.
 *
 * Source of rates: GitHub's published models-and-pricing table
 * (https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
 * Units match pi: USD per 1M tokens, optional request-wide long-context tiers.
 *
 * The table is static on purpose. New models are not scraped at runtime -
 * ship an update in pricing.json, or drop a user override at
 * ~/.pi/agent/copilot-pricing.json (or $PI_CODING_AGENT_DIR/copilot-pricing.json).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ModelCostRates = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ModelCostTier = ModelCostRates & {
	inputTokensAbove: number;
};

export type ModelCost = ModelCostRates & {
	tiers?: ModelCostTier[];
};

export type PricingTable = Record<string, ModelCost>;

export const ZERO_COST: ModelCost = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

const BUNDLED_PRICING_PATH = join(dirname(fileURLToPath(import.meta.url)), "pricing.json");
const USER_PRICING_FILENAME = "copilot-pricing.json";

/** Same base dir as pi's auth.json (including PI_CODING_AGENT_DIR). */
export function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	return envDir
		? envDir.replace(/^~(\/|$)/, `${homedir()}$1`)
		: join(homedir(), ".pi", "agent");
}

export function getUserPricingPath(): string {
	return join(getAgentDir(), USER_PRICING_FILENAME);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseRates(value: unknown): ModelCostRates | null {
	const rec = value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
	if (!rec) return null;
	if (
		!isFiniteNumber(rec.input) ||
		!isFiniteNumber(rec.output) ||
		!isFiniteNumber(rec.cacheRead) ||
		!isFiniteNumber(rec.cacheWrite)
	) {
		return null;
	}
	return {
		input: rec.input,
		output: rec.output,
		cacheRead: rec.cacheRead,
		cacheWrite: rec.cacheWrite,
	};
}

function parseTier(value: unknown): ModelCostTier[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const out: ModelCostTier[] = [];
	for (const raw of value) {
		const rates = parseRates(raw);
		const rec = raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: undefined;
		if (!rates || !rec || !isFiniteNumber(rec.inputTokensAbove) || rec.inputTokensAbove < 0) {
			continue;
		}
		out.push({ ...rates, inputTokensAbove: rec.inputTokensAbove });
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Parse a pricing JSON object. Invalid model entries are dropped so a single
 * bad override cannot wipe the whole table.
 */
export function parsePricingTable(body: unknown): PricingTable {
	const root = body && typeof body === "object" && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: undefined;
	if (!root) {
		throw new Error("pricing table must be a JSON object keyed by model id");
	}

	const out: PricingTable = {};
	for (const [id, value] of Object.entries(root)) {
		// Skip documentation / meta keys if someone nests them later.
		if (!id || id.startsWith("_")) continue;
		const rates = parseRates(value);
		if (!rates) continue;
		const rec = value as Record<string, unknown>;
		const tiers = parseTier(rec.tiers);
		out[id] = tiers ? { ...rates, tiers } : rates;
	}
	return out;
}

async function readPricingFile(path: string, label: string): Promise<PricingTable | null> {
	try {
		const buf = await readFile(path, "utf8");
		if (buf.length > 1_000_000) {
			console.error(`pi-copilot-discovery: ${label} is unexpectedly large; ignoring`);
			return null;
		}
		return parsePricingTable(JSON.parse(buf) as unknown);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return null;
		console.error(
			`pi-copilot-discovery: could not load ${label} (${err instanceof Error ? err.message : String(err)})`,
		);
		return null;
	}
}

/** User keys replace bundled keys wholesale per model id. */
export function mergePricing(bundled: PricingTable, user: PricingTable): PricingTable {
	return { ...bundled, ...user };
}

export function resolveModelCost(id: string, table: PricingTable): ModelCost {
	const hit = table[id];
	if (!hit) return { ...ZERO_COST };
	const cost: ModelCost = {
		input: hit.input,
		output: hit.output,
		cacheRead: hit.cacheRead,
		cacheWrite: hit.cacheWrite,
	};
	if (hit.tiers && hit.tiers.length > 0) {
		cost.tiers = hit.tiers.map((t) => ({ ...t }));
	}
	return cost;
}

/**
 * Short-context ceiling for models with long-context pricing tiers.
 *
 * GitHub bills the higher long-context rates when total input exceeds
 * `inputTokensAbove`. Returning that threshold as the default
 * `contextWindow` keeps pi's compaction budget inside the cheaper tier
 * (same pattern as pi-ai's direct OpenAI catalog).
 *
 * Returns undefined when the model has no long-context tier.
 */
export function getShortContextCeiling(id: string, table: PricingTable): number | undefined {
	const tiers = table[id]?.tiers;
	if (!tiers || tiers.length === 0) return undefined;
	let min = Infinity;
	for (const tier of tiers) {
		if (tier.inputTokensAbove > 0 && tier.inputTokensAbove < min) {
			min = tier.inputTokensAbove;
		}
	}
	return min === Infinity ? undefined : min;
}

export type ContextMode = "default" | "long";

/**
 * Resolve the context window pi should advertise for a model.
 *
 * - default mode + long-context pricing tier → cap at the short-tier ceiling
 *   so compaction keeps sessions in the cheaper rate band.
 * - long mode (or no tier) → use the full window advertised by /models.
 * - never invent a window larger than what /models advertised.
 */
export function resolveContextWindow(
	advertised: number,
	modelId: string,
	table: PricingTable,
	mode: ContextMode = "default",
): number {
	if (mode === "long") return advertised;
	const ceiling = getShortContextCeiling(modelId, table);
	if (ceiling === undefined) return advertised;
	return Math.min(advertised, ceiling);
}

/**
 * Load bundled rates, then merge optional user overrides.
 * Safe to call on every discovery refresh so override edits apply without restart.
 */
export async function loadPricingTable(): Promise<PricingTable> {
	const bundled = (await readPricingFile(BUNDLED_PRICING_PATH, "bundled pricing.json")) ?? {};
	const user = (await readPricingFile(getUserPricingPath(), USER_PRICING_FILENAME)) ?? {};
	return mergePricing(bundled, user);
}
