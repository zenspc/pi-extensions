import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { DEVTOOLS_ACTIVE_PORT_FILE } from "./launch.ts";
import {
	SINGLETON_COOKIE_FILE,
	SINGLETON_LOCK_FILE,
	SINGLETON_SOCKET_FILE,
	clearStaleLock,
	inspectOccupancy,
	parseLockTarget,
	readChromeLock,
} from "./occupancy.ts";

class CodedError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}

const DIR = "/tmp/pi-chrome-occupancy";
const LOCK_PATH = join(DIR, SINGLETON_LOCK_FILE);

describe("parseLockTarget", () => {
	it("reads hostname and pid from the last dash", () => {
		assert.deepEqual(parseLockTarget("host-42"), { hostname: "host", pid: 42 });
		assert.deepEqual(parseLockTarget("my-host-1001"), { hostname: "my-host", pid: 1001 });
	});

	it("rejects empty, non-integer, and non-positive pids", () => {
		assert.equal(parseLockTarget(""), undefined);
		assert.equal(parseLockTarget("host-"), undefined);
		assert.equal(parseLockTarget("-12"), undefined);
		assert.equal(parseLockTarget("host-nope"), undefined);
		assert.equal(parseLockTarget("host-0"), undefined);
		assert.equal(parseLockTarget("host-1.5"), undefined);
	});
});

describe("readChromeLock", () => {
	it("is absent when the lock file is missing", () => {
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: () => {
					throw new CodedError("ENOENT");
				},
			}),
			{ kind: "absent" },
		);
	});

	it("is stale when this host's pid is dead", () => {
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: (path) => {
					assert.equal(path, LOCK_PATH);
					return "box-999";
				},
				hostname: () => "box",
				processExists: (pid) => {
					assert.equal(pid, 999);
					return false;
				},
			}),
			{ kind: "stale", pid: 999 },
		);
	});

	it("is live when this host's pid exists", () => {
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: () => "box-7",
				hostname: () => "box",
				processExists: (pid) => pid === 7,
			}),
			{ kind: "live", pid: 7 },
		);
	});

	it("is live when the lock is unreadable, unparseable, or for another host", () => {
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: () => {
					throw new CodedError("EINVAL");
				},
			}),
			{ kind: "live" },
		);
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: () => "not-a-lock",
				hostname: () => "box",
			}),
			{ kind: "live" },
		);
		assert.deepEqual(
			readChromeLock(DIR, {
				readlink: () => "other-7",
				hostname: () => "box",
				processExists: () => false,
			}),
			{ kind: "live" },
		);
	});
});

describe("inspectOccupancy", () => {
	it("does not probe the Debug Port when the lock is absent or stale", async () => {
		let probed = 0;
		const waitForPort = async () => {
			probed++;
			return 1;
		};
		assert.deepEqual(
			await inspectOccupancy(DIR, {
				readlink: () => {
					throw new CodedError("ENOENT");
				},
				waitForPort,
			}),
			{ kind: "empty" },
		);
		assert.deepEqual(
			await inspectOccupancy(DIR, {
				readlink: () => "box-999",
				hostname: () => "box",
				processExists: () => false,
				waitForPort,
			}),
			{ kind: "stale-lock" },
		);
		assert.equal(probed, 0);
	});

	it("is live-with-debug when a live lock's Debug Port answers", async () => {
		assert.deepEqual(
			await inspectOccupancy(DIR, {
				readlink: () => "box-7",
				hostname: () => "box",
				processExists: () => true,
				waitForPort: async (userDataDir) => {
					assert.equal(userDataDir, DIR);
					return 45000;
				},
			}),
			{ kind: "live-with-debug", port: 45000 },
		);
	});

	it("is live-without-debug when a live lock has no Debug Port", async () => {
		assert.deepEqual(
			await inspectOccupancy(DIR, {
				readlink: () => "box-7",
				hostname: () => "box",
				processExists: () => true,
				waitForPort: async () => {
					throw new Error("no port");
				},
			}),
			{ kind: "live-without-debug" },
		);
	});
});

describe("clearStaleLock", () => {
	it("unlinks the singleton files and leftover DevToolsActivePort", () => {
		const removed: string[] = [];
		clearStaleLock(DIR, (path) => {
			removed.push(path);
		});
		assert.deepEqual(removed, [
			join(DIR, SINGLETON_LOCK_FILE),
			join(DIR, SINGLETON_SOCKET_FILE),
			join(DIR, SINGLETON_COOKIE_FILE),
			join(DIR, DEVTOOLS_ACTIVE_PORT_FILE),
		]);
	});
});
