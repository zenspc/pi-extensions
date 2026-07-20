/** Quiet built-in tool names (v1/v2 scope). */

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

export function isQuietToolName(name: string): name is QuietToolName {
	return (QUIET_TOOL_NAMES as readonly string[]).includes(name);
}
