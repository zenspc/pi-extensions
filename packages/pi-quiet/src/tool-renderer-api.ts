/**
 * Optional Pi Tool Renderer Wrapper seam.
 * Present when @earendil-works/pi-coding-agent exposes registerToolRenderer.
 */

import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolRenderContext,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

export type ToolRenderShell = "default" | "self";

export type StockToolRenderers = {
	renderShell?: ToolRenderShell;
	renderCall?: (
		args: Record<string, unknown>,
		theme: Theme,
		context: ToolRenderContext<unknown, Record<string, unknown>>,
	) => Component;
	renderResult?: (
		result: AgentToolResult<unknown>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: ToolRenderContext<unknown, Record<string, unknown>>,
	) => Component;
};

export type ToolRendererWrapContext = {
	name: string;
	label?: string;
};

export type ToolRendererWrapper = (
	tool: ToolRendererWrapContext,
	renderers: StockToolRenderers,
) => StockToolRenderers;

export type ExtensionAPIWithToolRenderer = ExtensionAPI & {
	registerToolRenderer?: (wrap: ToolRendererWrapper) => void;
};

export function tryRegisterToolRenderer(
	pi: ExtensionAPI,
	wrap: ToolRendererWrapper,
): boolean {
	const api = pi as ExtensionAPIWithToolRenderer;
	if (typeof api.registerToolRenderer !== "function") return false;
	api.registerToolRenderer(wrap);
	return true;
}
