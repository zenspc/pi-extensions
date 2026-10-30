import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createCustomFooter } from "./footer/custom.ts";
import { createContextBar } from "./footer/context-bar.ts";

const FOOTERS = ["custom-footer", "context-bar"] as const;
type Footer = (typeof FOOTERS)[number];

function isFooter(value: unknown): value is Footer {
	return FOOTERS.some((footer) => footer === value);
}

export default function (pi: ExtensionAPI) {
	const configPath = join(getAgentDir(), "footer.json");
	let selected: Footer = "custom-footer";
	let dispose: (() => void) | undefined;

	const apply = (ctx: ExtensionContext) => {
		dispose?.();
		const factory =
			selected === "custom-footer"
				? createCustomFooter(pi, ctx)
				: createContextBar(pi, ctx);
		ctx.ui.setFooter((...args) => {
			const component = factory(...args);
			let disposed = false;
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				component.dispose?.();
			};
			dispose = cleanup;
			return { ...component, dispose: cleanup };
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		selected = "custom-footer";
		try {
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			if (!isFooter(config?.style))
				throw new Error("Unknown footer style");
			selected = config.style;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				ctx.ui.notify(
					`Could not load ${configPath}; using custom-footer: ${String(
						error
					)}`,
					"warning"
				);
			}
		}
		apply(ctx);
	});

	pi.on("session_shutdown", async () => {
		dispose?.();
		dispose = undefined;
	});

	pi.registerCommand("footer", {
		description: "Choose a footer layout (saved globally)",
		getArgumentCompletions: (prefix) =>
			FOOTERS.filter((footer) => footer.startsWith(prefix)).map(
				(footer) => ({ value: footer, label: footer })
			),
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/footer requires interactive mode", "error");
				return;
			}
			const choice =
				args.trim() ||
				(await ctx.ui.select(`Footer (current: ${selected})`, [
					...FOOTERS,
				]));
			if (choice === undefined) return;
			if (!isFooter(choice)) {
				ctx.ui.notify(
					`Unknown footer. Choose: ${FOOTERS.join(", ")}`,
					"error"
				);
				return;
			}
			const tempPath = `${configPath}.${randomUUID()}.tmp`;
			let tempWritten = false;
			try {
				mkdirSync(dirname(configPath), { recursive: true });
				writeFileSync(
					tempPath,
					JSON.stringify({ style: choice }, null, 2) + "\n",
					{ flag: "wx", mode: 0o600 }
				);
				tempWritten = true;
				renameSync(tempPath, configPath);
			} catch (error) {
				ctx.ui.notify(
					`Could not save footer preference: ${String(error)}`,
					"error"
				);
				return;
			} finally {
				if (tempWritten) rmSync(tempPath, { force: true });
			}
			selected = choice;
			apply(ctx);
			ctx.ui.notify(`Footer: ${selected} (saved globally)`, "info");
		},
	});
}
