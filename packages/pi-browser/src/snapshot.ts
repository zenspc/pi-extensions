import type { ElementHandle, JSHandle, Page } from "playwright-core";

export const REF_PATTERN = /^e\d+$/;
const MAX_REFS = 1_000;
const MAX_CHARS = 50_000;
const MAX_NODES = 20_000;
type Registry = { names: WeakMap<Element, string>; refs: Record<string, Element> };
type SnapshotState = { registry?: JSHandle<Registry> };
const states = new WeakMap<Page, SnapshotState>();
let nextRef = 1;

export function staleRefError(ref: string): Error {
	return new Error(
		`Unknown or stale Element Ref "${ref}". Take a new browser_snapshot and use a Ref from its output.`
	);
}

function stateFor(tab: Page): SnapshotState {
	let state = states.get(tab);
	if (state) return state;
	state = {};
	states.set(tab, state);
	tab.on("framenavigated", (frame) => {
		if (frame !== tab.mainFrame()) return;
		const current = states.get(tab);
		void current?.registry?.dispose().catch(() => undefined);
		states.set(tab, {});
	});
	return state;
}

// The caller owns the returned handle and must dispose it after acting.
export async function refLocator(tab: Page, ref: string): Promise<ElementHandle<Element>> {
	if (!REF_PATTERN.test(ref)) throw staleRefError(ref);
	const registry = states.get(tab)?.registry;
	if (!registry) throw staleRefError(ref);
	let handle: JSHandle | undefined;
	try {
		handle = await tab.evaluateHandle(({ registry, ref }) => registry.refs[ref] ?? null, {
			registry,
			ref,
		});
		const element = handle.asElement();
		if (
			element &&
			(await element.evaluate((el) => el.isConnected && el.ownerDocument === document))
		)
			return element;
	} catch {}
	await handle?.dispose().catch(() => undefined);
	throw staleRefError(ref);
}

export type SnapshotResult = { title: string; url: string; text: string };

export async function takeSnapshot(tab: Page): Promise<SnapshotResult> {
	const state = stateFor(tab);
	state.registry ??= await tab.evaluateHandle(() => ({
		names: new WeakMap<Element, string>(),
		refs: {} as Record<string, Element>,
	}));
	const start = nextRef;
	nextRef += MAX_REFS;
	const result = await tab.evaluate(
		({ registry, start, maxRefs, maxChars, maxNodes }) => {
			registry.refs = {};
			let next = start;
			let refs = 0;
			let chars = 0;
			let visited = 0;
			let truncated = false;
			const lines: string[] = [];
			const interactiveRoles = new Set([
				"button",
				"link",
				"textbox",
				"searchbox",
				"combobox",
				"checkbox",
				"radio",
				"slider",
				"spinbutton",
				"switch",
				"tab",
				"menuitem",
				"menuitemcheckbox",
				"menuitemradio",
				"option",
				"treeitem",
			]);
			const landmarks: Record<string, string> = {
				NAV: "navigation",
				HEADER: "banner",
				FOOTER: "contentinfo",
				MAIN: "main",
				ASIDE: "complementary",
				FORM: "form",
			};
			const ignored = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD"]);
			const collapse = (text: string | null | undefined) =>
				(text ?? "").replace(/\s+/g, " ").trim();
			const quote = (text: string) => JSON.stringify(text.slice(0, 300));

			function nameFor(el: Element): string {
				const labelledby = el.getAttribute("aria-labelledby");
				if (labelledby) {
					const root = el.getRootNode();
					const label = collapse(
						labelledby
							.split(/\s+/)
							.map((id) =>
								root instanceof Document || root instanceof ShadowRoot
									? root.getElementById(id)?.textContent ?? ""
									: ""
							)
							.join(" ")
					);
					if (label) return label;
				}
				const label = collapse(el.getAttribute("aria-label"));
				if (label) return label;
				if (
					el instanceof HTMLInputElement ||
					el instanceof HTMLTextAreaElement ||
					el instanceof HTMLSelectElement
				) {
					const labels = collapse(
						Array.from(el.labels ?? [])
							.map((label) => label.textContent)
							.join(" ")
					);
					if (labels) return labels;
				}
				if (
					el instanceof HTMLInputElement &&
					["submit", "button", "reset"].includes(el.type)
				)
					return el.value;
				return collapse(
					el.getAttribute("alt") ||
						el.getAttribute("placeholder") ||
						(el as HTMLElement).innerText ||
						el.getAttribute("title")
				);
			}

			function roleFor(el: Element): string {
				const explicit = el.getAttribute("role")?.split(/\s+/)[0];
				if (explicit && explicit !== "none" && explicit !== "presentation") return explicit;
				if (/^H[1-6]$/.test(el.tagName)) return `heading ${el.tagName[1]}`;
				if (el instanceof HTMLInputElement) {
					return (
						(
							{
								checkbox: "checkbox",
								radio: "radio",
								range: "slider",
								number: "spinbutton",
								search: "searchbox",
								submit: "button",
								button: "button",
								reset: "button",
							} as Record<string, string>
						)[el.type] ?? "textbox"
					);
				}
				if (el.matches("textarea, [contenteditable]:not([contenteditable=false])"))
					return "textbox";
				return (
					(
						{
							A: el.hasAttribute("href") ? "link" : "generic",
							BUTTON: "button",
							SELECT: "combobox",
							SUMMARY: "button",
							IMG: "img",
						} as Record<string, string>
					)[el.tagName] ??
					landmarks[el.tagName] ??
					"generic"
				);
			}

			function emit(text: string, depth: number): boolean {
				const line = `${"\t".repeat(Math.min(depth, 12))}${text}`;
				if (chars + line.length + 1 > maxChars) {
					truncated = true;
					return false;
				}
				lines.push(line);
				chars += line.length + 1;
				return true;
			}

			const stack: { node: Node; depth: number }[] = document.body
				? [{ node: document.body, depth: 0 }]
				: [];
			while (stack.length) {
				if (++visited > maxNodes || refs >= maxRefs) {
					truncated = true;
					break;
				}
				const { node, depth } = stack.pop()!;
				if (node.nodeType === Node.TEXT_NODE) {
					const text = collapse(node.textContent);
					if (text && !emit(`- text ${quote(text)}`, depth)) break;
					continue;
				}
				if (!(node instanceof Element) || ignored.has(node.tagName)) continue;
				if (node.matches('[hidden], [inert], [aria-hidden="true"], input[type="hidden"]'))
					continue;
				const style = getComputedStyle(node);
				if (
					style.display === "none" ||
					style.visibility === "hidden" ||
					style.visibility === "collapse"
				)
					continue;
				const role = roleFor(node);
				const interactive =
					interactiveRoles.has(role) || node.matches('[tabindex]:not([tabindex="-1"])');
				const name =
					interactive ||
					role.startsWith("heading") ||
					role === "img" ||
					node.hasAttribute("aria-label")
						? nameFor(node)
						: "";
				let childDepth = depth;
				if (interactive) {
					let ref = registry.names.get(node);
					if (!ref) {
						ref = `e${next++}`;
						registry.names.set(node, ref);
					}
					registry.refs[ref] = node;
					refs++;
					const disabled = node.matches(":disabled, [aria-disabled=true]")
						? " [disabled]"
						: "";
					const checked =
						node instanceof HTMLInputElement &&
						["checkbox", "radio"].includes(node.type)
							? ` [checked=${node.checked}]`
							: "";
					if (!emit(`- ${role} ${quote(name)} [ref=${ref}]${disabled}${checked}`, depth))
						break;
					continue;
				}
				if (role.startsWith("heading") || role === "img") {
					if (name && !emit(`- ${role} ${quote(name)}`, depth)) break;
					continue;
				}
				if (role !== "generic") {
					if (
						!emit(
							`${role}${node.hasAttribute("aria-label") ? ` ${quote(name)}` : ""}`,
							depth
						)
					)
						break;
					childDepth++;
				}
				const children = Array.from(node.shadowRoot?.childNodes ?? node.childNodes);
				for (let i = children.length - 1; i >= 0; i--)
					stack.push({ node: children[i], depth: childDepth });
			}
			if (truncated)
				lines.push(
					"[Snapshot truncated; use browser_evaluate to inspect a focused subset]"
				);
			return {
				title: document.title.slice(0, 1000),
				url: location.href.slice(0, 16_384),
				text: lines.join("\n"),
			};
		},
		{
			registry: state.registry,
			start,
			maxRefs: MAX_REFS,
			maxChars: MAX_CHARS,
			maxNodes: MAX_NODES,
		}
	);
	if (states.get(tab) !== state)
		throw new Error("Page changed during browser_snapshot. Take a new browser_snapshot.");
	return result;
}
