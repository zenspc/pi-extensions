import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachment } from "./attachment.ts";
import { launchDedicatedChrome } from "./launch.ts";
import { resolveChromeBinary } from "./resolve.ts";

export async function startTestApp(handler: RequestListener) {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: (server.address() as AddressInfo).port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

export function createTestBrowser(extraArgs: string[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "pi-browser-test-"));
	let chrome: ChildProcess | undefined;
	const attachment = createAttachment({
		userDataDir: dir,
		chromeBin: resolveChromeBinary(),
		extraArgs: ["--headless=new", ...extraArgs],
		launchChrome: async (spec) => {
			chrome = launchDedicatedChrome(spec);
			await once(chrome, "spawn");
		},
	});
	return {
		dir,
		attachment,
		async close() {
			try {
				await attachment.close();
			} finally {
				if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
					const exited = once(chrome, "exit");
					const kill = (signal: NodeJS.Signals) => {
						try {
							process.kill(-chrome!.pid!, signal);
						} catch {
							chrome!.kill(signal);
						}
					};
					kill("SIGTERM");
					const timer = setTimeout(() => kill("SIGKILL"), 5_000);
					try {
						await exited;
					} finally {
						clearTimeout(timer);
					}
				}
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			}
		},
	};
}
