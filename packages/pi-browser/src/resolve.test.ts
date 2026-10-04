import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHROME_BIN_ENV,
	MissingChromeBinaryError,
	RelativeUserDataDirError,
	USER_DATA_DIR_ENV,
	resolveChromeBinary,
	resolveUserDataDir,
} from "./resolve.ts";

describe("resolveUserDataDir", () => {
	it("defaults to {homedir}/.pi-chrome on linux, darwin, and win32", () => {
		assert.equal(
			resolveUserDataDir({ env: {}, homedir: "/home/rey", platform: "linux" }),
			"/home/rey/.pi-chrome",
		);
		assert.equal(
			resolveUserDataDir({ env: {}, homedir: "/Users/rey", platform: "darwin" }),
			"/Users/rey/.pi-chrome",
		);
		assert.equal(
			resolveUserDataDir({ env: {}, homedir: "C:\\Users\\rey", platform: "win32" }),
			"C:\\Users\\rey\\.pi-chrome",
		);
	});

	it("accepts an absolute PI_BROWSER_USER_DATA_DIR", () => {
		assert.equal(
			resolveUserDataDir({
				env: { [USER_DATA_DIR_ENV]: "/abs/dir" },
				homedir: "/home/rey",
				platform: "linux",
			}),
			"/abs/dir",
		);
	});

	it("expands ~/ on PI_BROWSER_USER_DATA_DIR", () => {
		assert.equal(
			resolveUserDataDir({
				env: { [USER_DATA_DIR_ENV]: "~/agent" },
				homedir: "/home/rey",
				platform: "linux",
			}),
			"/home/rey/agent",
		);
	});

	it("expands ~\\ on win32", () => {
		assert.equal(
			resolveUserDataDir({
				env: { [USER_DATA_DIR_ENV]: "~\\agent" },
				homedir: "C:\\Users\\rey",
				platform: "win32",
			}),
			"C:\\Users\\rey\\agent",
		);
	});

	it("expands ~/ on win32 with the family separator", () => {
		assert.equal(
			resolveUserDataDir({
				env: { [USER_DATA_DIR_ENV]: "~/agent" },
				homedir: "C:\\Users\\rey",
				platform: "win32",
			}),
			"C:\\Users\\rey\\agent",
		);
	});

	it("rejects a relative PI_BROWSER_USER_DATA_DIR", () => {
		assert.throws(
			() =>
				resolveUserDataDir({
					env: { [USER_DATA_DIR_ENV]: "relative" },
					homedir: "/home/rey",
					platform: "linux",
				}),
			(error: unknown) =>
				error instanceof RelativeUserDataDirError && /absolute/.test(error.message),
		);
	});

	it("does not expand ~name", () => {
		assert.throws(
			() =>
				resolveUserDataDir({
					env: { [USER_DATA_DIR_ENV]: "~other/chrome" },
					homedir: "/home/rey",
					platform: "linux",
				}),
			(error: unknown) =>
				error instanceof RelativeUserDataDirError && /absolute/.test(error.message),
		);
	});

	it("treats empty and whitespace env values as unset", () => {
		assert.equal(
			resolveUserDataDir({
				env: { [USER_DATA_DIR_ENV]: "  " },
				homedir: "/home/rey",
				platform: "linux",
			}),
			"/home/rey/.pi-chrome",
		);
	});
});

describe("resolveChromeBinary", () => {
	it("uses PI_BROWSER_CHROME_BIN when that path exists", () => {
		const queried: string[] = [];
		assert.equal(
			resolveChromeBinary({
				env: { [CHROME_BIN_ENV]: "/opt/chrome" },
				platform: "linux",
				exists: (path) => {
					queried.push(path);
					return path === "/opt/chrome";
				},
			}),
			"/opt/chrome",
		);
		assert.deepEqual(queried, ["/opt/chrome"]);
	});

	it("expands a leading ~ on PI_BROWSER_CHROME_BIN", () => {
		assert.equal(
			resolveChromeBinary({
				env: { [CHROME_BIN_ENV]: "~/opt/chrome" },
				homedir: "/home/rey",
				platform: "linux",
				exists: (path) => path === "/home/rey/opt/chrome",
			}),
			"/home/rey/opt/chrome",
		);
	});

	it("resolves a PI_BROWSER_CHROME_BIN PATH name", () => {
		assert.equal(
			resolveChromeBinary({
				env: { [CHROME_BIN_ENV]: "google-chrome", PATH: "/opt/bin" },
				platform: "linux",
				exists: (path) =>
					path === "/opt/bin/google-chrome" || path === "/usr/bin/google-chrome-stable",
			}),
			"/opt/bin/google-chrome",
		);
	});

	it("accepts a relative PI_BROWSER_CHROME_BIN that exists as written", () => {
		assert.equal(
			resolveChromeBinary({
				env: { [CHROME_BIN_ENV]: "./chrome" },
				platform: "linux",
				exists: (path) => path === "./chrome",
			}),
			"./chrome",
		);
	});

	it("returns the first existing linux candidate", () => {
		assert.equal(
			resolveChromeBinary({
				env: {},
				platform: "linux",
				exists: (path) =>
					path === "/usr/bin/google-chrome" || path === "/usr/bin/chromium",
			}),
			"/usr/bin/google-chrome",
		);
	});

	it("does not query chrome.exe on linux", () => {
		const queried: string[] = [];
		assert.throws(() =>
			resolveChromeBinary({
				env: { PATH: "/usr/bin:/usr/local/bin" },
				platform: "linux",
				exists: (path) => {
					queried.push(path);
					return false;
				},
			}),
		);
		assert.equal(
			queried.some((path) => path.endsWith("chrome.exe")),
			false,
		);
	});

	it("treats unknown platforms as linux", () => {
		assert.equal(
			resolveUserDataDir({ env: {}, homedir: "/home/rey", platform: "freebsd" }),
			"/home/rey/.pi-chrome",
		);
		const queried: string[] = [];
		assert.throws(() =>
			resolveChromeBinary({
				env: {},
				platform: "freebsd",
				exists: (path) => {
					queried.push(path);
					return false;
				},
			}),
		);
		assert.ok(queried.includes("/usr/bin/google-chrome-stable"));
		assert.equal(
			queried.some((path) => path.endsWith("chrome.exe")),
			false,
		);
	});

	it("finds the Darwin Chrome app path", () => {
		assert.equal(
			resolveChromeBinary({
				env: {},
				platform: "darwin",
				exists: (path) =>
					path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			}),
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
	});

	it("builds win32 Chrome paths from PROGRAMFILES", () => {
		assert.equal(
			resolveChromeBinary({
				env: { PROGRAMFILES: "D:\\Apps" },
				platform: "win32",
				exists: (path) => path === "D:\\Apps\\Google\\Chrome\\Application\\chrome.exe",
			}),
			"D:\\Apps\\Google\\Chrome\\Application\\chrome.exe",
		);
	});

	it("throws MissingChromeBinaryError naming the env when nothing exists", () => {
		assert.throws(
			() =>
				resolveChromeBinary({
					env: {},
					platform: "linux",
					exists: () => false,
				}),
			(error: unknown) =>
				error instanceof MissingChromeBinaryError && error.message.includes(CHROME_BIN_ENV),
		);
	});

	it("throws naming the env and the missing override", () => {
		assert.throws(
			() =>
				resolveChromeBinary({
					env: { [CHROME_BIN_ENV]: "/missing/chrome" },
					platform: "linux",
					exists: () => false,
				}),
			(error: unknown) =>
				error instanceof MissingChromeBinaryError &&
				error.message.includes(CHROME_BIN_ENV) &&
				error.message.includes("/missing/chrome"),
		);
	});

	it("treats a whitespace PI_BROWSER_CHROME_BIN as unset", () => {
		assert.equal(
			resolveChromeBinary({
				env: { [CHROME_BIN_ENV]: "\t", PATH: "/opt/bin" },
				platform: "linux",
				exists: (path) => path === "/usr/bin/google-chrome",
			}),
			"/usr/bin/google-chrome",
		);
	});
});
