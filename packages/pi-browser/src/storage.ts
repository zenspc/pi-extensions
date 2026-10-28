import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function writeJsonAtomic(path: string, value: unknown): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600, flag: "wx" });
		renameSync(tmp, path);
	} finally {
		rmSync(tmp, { force: true });
	}
}
