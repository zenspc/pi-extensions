/**
 * Pure helpers for the welcome header resource panel.
 * Kept as ESM so monorepo node:test can import without a TS build step.
 */

export const SECTION_IDS = ["Context", "Skills", "Prompts", "Extensions", "Themes"];

/**
 * @typedef {"Context" | "Skills" | "Prompts" | "Extensions" | "Themes"} SectionId
 * @typedef {{
 *   context: string[],
 *   skills: string[],
 *   prompts: string[],
 *   extensions: string[],
 *   themes: string[],
 * }} WelcomeResources
 */

/**
 * @param {string} value
 * @returns {value is SectionId}
 */
export function isSectionId(value) {
	for (const id of SECTION_IDS) {
		if (id === value) return true;
	}
	return false;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * @param {string} text
 * @returns {string | undefined}
 */
export function getSectionHeading(text) {
	return stripAnsi(text.split("\n", 1)[0] ?? "")
		.trim()
		.match(/^\[([^\]]+)\]$/)?.[1];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitCommaItems(text) {
	const body = stripAnsi(text).split("\n").slice(1).join(" ");
	const items = [];
	const seen = new Set();
	for (const part of body.split(",")) {
		const item = part.trim();
		if (!item || seen.has(item)) continue;
		seen.add(item);
		items.push(item);
	}
	return items;
}

/**
 * @returns {WelcomeResources}
 */
export function emptyWelcomeResources() {
	return {
		context: [],
		skills: [],
		prompts: [],
		extensions: [],
		themes: [],
	};
}

/**
 * @param {string[]} texts
 * @returns {WelcomeResources}
 */
export function parseResourceSections(texts) {
	const resources = emptyWelcomeResources();
	const keys = {
		Context: "context",
		Skills: "skills",
		Prompts: "prompts",
		Extensions: "extensions",
		Themes: "themes",
	};

	for (const text of texts) {
		const heading = getSectionHeading(text);
		if (!heading || !isSectionId(heading)) continue;
		resources[keys[heading]] = splitCommaItems(text);
	}
	return resources;
}

/**
 * @param {WelcomeResources} resources
 * @returns {boolean}
 */
export function captureIsComplete(resources) {
	return resources.extensions.some(
		(name) =>
			name === "welcome-header" ||
			name.endsWith("/welcome-header") ||
			name.endsWith("welcome-header.ts"),
	);
}
