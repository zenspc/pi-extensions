const TWO_PART_SUFFIXES = new Set([
	"co.uk",
	"org.uk",
	"ac.uk",
	"gov.uk",
	"com.au",
	"net.au",
	"org.au",
	"co.jp",
	"ne.jp",
	"or.jp",
	"co.in",
	"co.nz",
	"co.za",
	"co.kr",
	"com.br",
	"com.cn",
	"com.mx",
	"com.tr",
]);

export function registrableDomain(hostname: string): string {
	const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
	if (!host) return "";
	const labels = host.split(".");
	if (labels.length <= 2) return host;
	const lastTwo = labels.slice(-2).join(".");
	const scope = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
	return labels.slice(-scope).join(".");
}
