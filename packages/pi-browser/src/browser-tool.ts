import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import type { UrlExtractor } from "./gate.ts";
import { registerExtractor } from "./gate.ts";

export type BrowserToolDef<TParams extends TSchema, TDetails = unknown> =
	ToolDefinition<TParams, TDetails> & {
		urlFrom?: (input: Record<string, unknown>) => string;
	};

export function browserTool<TParams extends TSchema, TDetails = unknown>(
	pi: ExtensionAPI,
	def: BrowserToolDef<TParams, TDetails>,
): void {
	registerExtractor(def.name, def.urlFrom ?? defaultUrlFrom);
	pi.registerTool(def);
}

function defaultUrlFrom(input: Record<string, unknown>): string {
	return typeof input.url === "string" ? input.url : "";
}
