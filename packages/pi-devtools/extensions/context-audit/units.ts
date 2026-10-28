/** Token estimation and number formatting shared by analysis and rendering. */

/** Used until a provider-measured total allows calibration. */
export const DEFAULT_TOKENS_PER_CHAR = 1 / 4;
/** Pi's own flat estimate for one image (1200 tokens). */
export const IMAGE_CHARS = 4800;

/**
 * Tokens per character differ by content (prose ≈ 0.25, JSON and code ≈ 0.4) and by model,
 * so fixed overhead and conversation are priced separately.
 */
export interface Rates {
	setup: number;
	conversation: number;
}

export function jsonChars(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

export function fmtTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
	return String(Math.round(tokens));
}

export function fmtPercent(part: number, whole: number): string {
	if (whole <= 0 || part <= 0) return "0%";
	const p = (part / whole) * 100;
	return p < 0.1 ? "<0.1%" : p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** Collapse whitespace and cut to `max` characters for single-line previews. */
export function preview(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function sum<T>(items: readonly T[], pick: (item: T) => number): number {
	let total = 0;
	for (const item of items) total += pick(item);
	return total;
}

/** Group items by key, preserving insertion order of first sighting. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const bucket = groups.get(k);
		if (bucket) bucket.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}

/** Greedy word wrap for plain text; words longer than `width` stay whole. */
export function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);
	return lines;
}
