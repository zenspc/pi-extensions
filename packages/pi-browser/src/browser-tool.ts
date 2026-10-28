import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { registerExtractor } from "./gate.ts";

export type BrowserToolDef<TParams extends TSchema, TDetails = unknown> = ToolDefinition<
	TParams,
	TDetails
> & {
	urlFrom?: (input: Record<string, unknown>, signal?: AbortSignal) => string | Promise<string>;
};

export function browserTool<TParams extends TSchema, TDetails = unknown>(
	pi: ExtensionAPI,
	def: BrowserToolDef<TParams, TDetails>
): void {
	const { urlFrom, ...tool } = def;
	registerExtractor(pi, def.name, urlFrom ?? defaultUrlFrom);
	pi.registerTool({ ...tool, executionMode: "sequential" });
}

function defaultUrlFrom(input: Record<string, unknown>): string {
	return typeof input.url === "string" ? input.url : "";
}
