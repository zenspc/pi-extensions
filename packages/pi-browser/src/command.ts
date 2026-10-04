export type BrowserCommand =
	| { action: "on" }
	| { action: "off" }
	| { action: "status" }
	| { action: "help" }
	| { action: "unknown"; token: string };

export type BrowserCommandResult = {
	available: boolean;
	changed: boolean;
	kind: "set" | "status" | "help";
};

export function parseBrowserCommand(args: string): BrowserCommand {
	const trimmed = (args ?? "").trim();
	if (!trimmed) return { action: "status" };

	const lower = trimmed.toLowerCase();
	if (lower === "on" || lower === "enable") return { action: "on" };
	if (lower === "off" || lower === "disable") return { action: "off" };
	if (lower === "status") return { action: "status" };
	if (lower === "help") return { action: "help" };

	return { action: "unknown", token: trimmed };
}

export function applyBrowserCommand(
	cmd: BrowserCommand,
	currentlyAvailable: boolean,
): BrowserCommandResult {
	switch (cmd.action) {
		case "on":
			return {
				available: true,
				changed: currentlyAvailable !== true,
				kind: "set",
			};
		case "off":
			return {
				available: false,
				changed: currentlyAvailable !== false,
				kind: "set",
			};
		case "status":
			return { available: currentlyAvailable, changed: false, kind: "status" };
		case "help":
		case "unknown":
			return { available: currentlyAvailable, changed: false, kind: "help" };
	}
}

export function formatBrowserStatus(available: boolean): string {
	return `Tool Availability: ${available ? "on" : "off"}`;
}

export function formatBrowserHelp(): string {
	return [
		"Usage: /browser [on|off|status|help]",
		"",
		"  (no args)     Show Tool Availability",
		"  on, enable    Offer Browser Tools",
		"  off, disable  Hide Browser Tools",
		"  status        Show Tool Availability",
		"  help          Show this help",
	].join("\n");
}
