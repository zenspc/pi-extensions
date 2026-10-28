import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const LEASE_FILE = ".pi-browser.lock";

export function acquireLease(userDataDir: string): () => void {
	mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
	const path = join(userDataDir, LEASE_FILE);
	const owner = JSON.stringify({ pid: process.pid, hostname: hostname(), token: randomUUID() });
	try {
		writeFileSync(path, owner, { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		throw new Error(
			`pi-browser: ${userDataDir} is already leased by another Attachment. ` +
				`Disconnect the other Pi session or set PI_BROWSER_USER_DATA_DIR to a different directory. ` +
				`After a crash, confirm the owner in ${path} has exited before removing that file.`,
			{ cause: error }
		);
	}
	let released = false;
	return () => {
		if (released) return;
		try {
			if (readFileSync(path, "utf8") === owner) unlinkSync(path);
			released = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			released = true;
		}
	};
}
