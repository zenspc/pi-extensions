/** Built-in tool kinds with specialized Kind Formatters. */

export const QUIET_TOOL_NAMES = [
	"read",
	"bash",
	"edit",
	"write",
	"find",
	"grep",
	"ls",
] as const;

export type QuietToolName = (typeof QUIET_TOOL_NAMES)[number];

/** Shared Kind Emoji for Foreign Tools (Generic Kind Formatter). */
export const FOREIGN_KIND_EMOJI = "🧩";

export function isQuietToolName(name: string): name is QuietToolName {
	return (QUIET_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Whether Foreign Tools join Quiet Display / Run Compaction.
 * Off until a Tool Renderer Wrapper is registered (Pi registerToolRenderer).
 * Built-ins always participate via registerTool overrides when the hook is absent.
 */
let foreignToolsQuiet = false;

export function setForeignToolsQuiet(enabled: boolean): void {
	foreignToolsQuiet = enabled;
}

export function foreignToolsQuietEnabled(): boolean {
	return foreignToolsQuiet;
}

/** True when this tool name paints Quiet Rows and may join Compaction Groups. */
export function toolParticipatesInQuiet(name: string): boolean {
	if (!name) return false;
	if (isQuietToolName(name)) return true;
	return foreignToolsQuiet;
}
