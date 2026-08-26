import type { Page } from "playwright-core";

export const REF_PATTERN = /^e\d+$/;

export function refSelector(ref: string): string {
	return `[data-pi-browser-ref="${ref}"]`;
}

export function staleRefError(ref: string): Error {
	return new Error(
		`Unknown or stale Element Ref "${ref}". Take a new browser_snapshot and use a Ref from its output.`,
	);
}

export async function refLocator(
	tab: Page,
	ref: string,
): Promise<ReturnType<Page["locator"]>> {
	if (!REF_PATTERN.test(ref)) throw staleRefError(ref);
	const locator = tab.locator(refSelector(ref));
	if ((await locator.count()) === 0) throw staleRefError(ref);
	return locator;
}

export type SnapshotResult = { title: string; url: string; text: string };

export async function takeSnapshot(tab: Page): Promise<SnapshotResult> {
	const text = await tab.evaluate(() => {
		const w = window as unknown as { __piBrowserNextRef?: number };
		w.__piBrowserNextRef ??= 1;
		const INTERACTIVE =
			"a[href], button, input, select, textarea, summary, [contenteditable], [tabindex], [role]";
		const LANDMARKS = new Set(["NAV", "HEADER", "FOOTER", "MAIN", "ASIDE", "FORM"]);
		const HEADING = /^H([1-6])$/;

		function collapse(text: string | null | undefined): string {
			return (text ?? "").replace(/\s+/g, " ").trim();
		}

		function nameFor(el: Element): string {
			const labelledby = el.getAttribute("aria-labelledby");
			if (labelledby) {
				const name = labelledby
					.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent ?? "")
					.join(" ");
				if (collapse(name)) return collapse(name);
			}
			const ariaLabel = collapse(el.getAttribute("aria-label"));
			if (ariaLabel) return ariaLabel;
			const id = el.getAttribute("id");
			if (id) {
				const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
				const name = collapse(label?.textContent);
				if (name) return name;
			}
			for (const attr of ["placeholder", "alt"] as const) {
				const name = collapse(el.getAttribute(attr));
				if (name) return name;
			}
			const value = collapse(
				el instanceof HTMLInputElement ? el.value : el.getAttribute("value"),
			);
			if (value) return value;
			return collapse((el as HTMLElement).innerText).slice(0, 80);
		}

		function roleFor(el: Element): string {
			const explicit = el.getAttribute("role");
			if (explicit) return explicit;
			const heading = HEADING.exec(el.tagName);
			if (heading) return `heading ${heading[1]}`;
			switch (el.tagName) {
				case "A":
					return "link";
				case "BUTTON":
					return "button";
				case "SELECT":
					return "combobox";
				case "TEXTAREA":
					return "textbox";
			}
			if (el instanceof HTMLInputElement) {
				switch ((el.getAttribute("type") ?? "text").toLowerCase()) {
					case "checkbox":
						return "checkbox";
					case "radio":
						return "radio";
					case "range":
						return "slider";
					case "submit":
					case "button":
					case "reset":
						return "button";
				}
				return "textbox";
			}
			return "generic";
		}

		function visible(el: Element): boolean {
			if (el.hasAttribute("role")) return true;
			return (
				(el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0
			);
		}

		function refTag(el: Element): string {
			let ref = el.getAttribute("data-pi-browser-ref");
			if (!ref) {
				const next = w.__piBrowserNextRef ?? 1;
				w.__piBrowserNextRef = next + 1;
				ref = `e${next}`;
				el.setAttribute("data-pi-browser-ref", ref);
			}
			return ref;
		}

		function render(el: Element, depth: number, lines: string[]): void {
			if (!visible(el)) return;
			if (LANDMARKS.has(el.tagName)) {
				lines.push(`${"\t".repeat(depth)}${el.tagName.toLowerCase()}`);
				for (const child of el.children) render(child, depth + 1, lines);
				return;
			}
			if (el.matches(INTERACTIVE)) {
				const name = nameFor(el).slice(0, 80);
				lines.push(
					`${"\t".repeat(depth)}- ${roleFor(el)} "${name}" [ref=${refTag(el)}]`,
				);
				return;
			}
			for (const child of el.children) render(child, depth, lines);
		}

		const lines: string[] = [];
		if (document.body) for (const child of document.body.children) render(child, 0, lines);
		return lines.join("\n");
	});
	const [title, url] = await Promise.all([tab.title(), Promise.resolve(tab.url())]);
	return { title, url, text };
}
