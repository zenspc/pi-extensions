/** Optional renderer resolver registration, retaining the pre-hook built-in fallback. */
import type {
	ExtensionAPI,
	ToolRendererResolver,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";

export type StockToolRenderers = ToolRenderers;

export function tryRegisterToolRenderer(
	pi: ExtensionAPI,
	resolve: ToolRendererResolver,
): boolean {
	if (typeof pi.registerToolRenderer !== "function") return false;
	pi.registerToolRenderer(resolve);
	return true;
}
