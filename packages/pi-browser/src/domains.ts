import { parse } from "tldts";

const TLDTS_OPTIONS = { allowPrivateDomains: true };

export type UrlClass =
	| { kind: "blank" }
	| { kind: "site"; domain: string }
	| { kind: "blocked" };

export function registrableDomain(hostname: string): string | undefined {
	const parsed = parse(hostname, TLDTS_OPTIONS);
	if (parsed.domain) return parsed.domain;
	const host = parsed.hostname;
	if (!host) return undefined;
	if (parsed.isIp || !host.includes(".")) return host;
	return undefined;
}

export function classifyUrl(url: URL): UrlClass {
	if (url.protocol === "about:") {
		return url.pathname.toLowerCase() === "blank" ? { kind: "blank" } : { kind: "blocked" };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "blocked" };
	const domain = registrableDomain(url.hostname);
	if (!domain) return { kind: "blocked" };
	return { kind: "site", domain };
}
