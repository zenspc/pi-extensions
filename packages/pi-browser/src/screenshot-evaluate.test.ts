import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright-core";
import { createAttachment } from "./attachment.ts";
import extension from "./index.ts";
import { createTestBrowser, startTestApp } from "./test-support.ts";

const PAGE_HTML = `<!doctype html>
<html><head><title>Eval page</title></head>
<body>
<main><p id="label">Ready</p><form method="post" action="/redirect-post">
<label>Message <input name="message"></label><button>Save</button>
</form></main>
</body></html>`;

type AnyTool = ToolDefinition<any, any>;

function loadTools(
	attachment: ReturnType<typeof createAttachment>,
	allowlistPath: string
): Map<string, AnyTool> {
	const tools = new Map<string, AnyTool>();
	const pi = {
		registerTool: (def: AnyTool) => tools.set(def.name, def),
		registerCommand: () => {},
		on: () => {},
	};
	extension(pi as unknown as ExtensionAPI, {
		attachment,
		allowlistPath,
		availabilityPath: `${allowlistPath}.availability`,
	});
	return tools;
}

describe("screenshot and evaluate integration", () => {
	let browser: ReturnType<typeof createTestBrowser>;
	let app: Awaited<ReturnType<typeof startTestApp>>;
	let tools: Map<string, AnyTool>;
	const submissions: { body: string; cookie: string }[] = [];

	function run(
		name: string,
		params: Record<string, unknown> = {},
		signal?: AbortSignal
	): Promise<any> {
		return tools.get(name)!.execute("test", params, signal, undefined, undefined as never);
	}

	before(async () => {
		browser = createTestBrowser();
		app = await startTestApp((req, res) => {
			if (req.method === "POST" && req.url === "/redirect-post") {
				req.resume();
				res.writeHead(307, { location: "/saved" });
				res.end();
				return;
			}
			res.setHeader("content-type", "text/html");
			res.setHeader("set-cookie", "piTest=yes; SameSite=Lax");
			if (req.method === "POST" && req.url === "/saved") {
				let body = "";
				req.on("data", (chunk) => {
					body += chunk;
				});
				req.on("end", () => {
					submissions.push({ body, cookie: req.headers.cookie ?? "" });
					res.end(PAGE_HTML);
				});
				return;
			}
			res.end(PAGE_HTML);
		});
		const allowlistPath = join(browser.dir, "allowlist.json");
		writeFileSync(allowlistPath, JSON.stringify({ version: 1, domains: ["127.0.0.1"] }));
		tools = loadTools(browser.attachment, allowlistPath);
	});
	after(async () => {
		await browser?.close();
		await app?.close();
	});

	async function goto(path: string): Promise<Page> {
		return browser.attachment.withTab(async (tab) => {
			await tab.goto(`http://127.0.0.1:${app.port}${path}`, { waitUntil: "load" });
			return tab;
		});
	}

	it("registers the screenshot and evaluate tools with URL gating", () => {
		assert.ok(tools.get("browser_screenshot"), "browser_screenshot registered");
		assert.ok(tools.get("browser_evaluate"), "browser_evaluate registered");
	});

	it("captures a valid PNG with plausible dimensions", async () => {
		await goto("/");
		const result = await run("browser_screenshot");

		const note = result.content.find((item: { type: string }) => item.type === "text");
		assert.match(note.text, /Screenshot captured \(\d+x\d+ px\)/);

		const image = result.content.find((item: { type: string }) => item.type === "image");
		assert.equal(image.mimeType, "image/png");
		const png = Buffer.from(image.data, "base64");
		assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
		assert.ok(result.details.width > 0);
		assert.ok(result.details.height > 0);
		assert.equal(png.readUInt32BE(16), result.details.width);
		assert.equal(png.readUInt32BE(20), result.details.height);
	});

	it("preserves form POST bodies and cookies through native 307 redirects", async () => {
		await goto("/");
		const snapshot = await run("browser_snapshot");
		const ref = (name: string) => {
			const line = snapshot.details.text
				.split("\n")
				.find((line: string) => line.includes(name));
			assert.ok(line);
			return /\[ref=(e\d+)\]/.exec(line)![1];
		};
		await run("browser_type", { ref: ref('textbox "Message"'), text: "Native browser POST" });
		await run("browser_click", { ref: ref('button "Save"') });
		assert.equal(submissions.length, 1);
		assert.equal(
			new URLSearchParams(submissions[0].body).get("message"),
			"Native browser POST"
		);
		assert.match(submissions[0].cookie, /piTest=yes/);
		assert.match(
			(await run("browser_evaluate", { expression: "location.pathname" })).details.result,
			/saved/
		);
	});

	it("serializes a number from the page context", async () => {
		await goto("/");
		const result = await run("browser_evaluate", { expression: "6 * 7" });
		assert.equal(result.content[0].text, "42");
		assert.equal(result.details.result, 42);
	});

	it("serializes an object from the page context", async () => {
		await goto("/");
		const result = await run("browser_evaluate", {
			expression: `(() => ({ label: document.getElementById("label").textContent, n: 3 }))()`,
		});
		assert.deepEqual(result.details.result, { label: "Ready", n: 3 });
		assert.equal(result.content[0].text, JSON.stringify({ label: "Ready", n: 3 }, null, 2));
	});

	it("serializes a string from the page context", async () => {
		await goto("/");
		const result = await run("browser_evaluate", { expression: `"hello".toUpperCase()` });
		assert.equal(result.content[0].text, '"HELLO"');
		assert.equal(result.details.result, "HELLO");
	});

	it("rechecks Domain Approval during execution even without the tool-call hook", async () => {
		await goto("/");
		await assert.rejects(
			run("browser_navigate", { url: "https://not-approved.test/" }),
			/not approved/
		);
		assert.match(
			(await run("browser_evaluate", { expression: "location.href" })).details.result,
			/127.0.0.1/
		);
	});

	it("normalizes non-JSON values so tool details remain persistable", async () => {
		await goto("/");
		for (const expression of [
			"123n",
			"NaN",
			"Infinity",
			"(() => { const x = {}; x.self = x; return x; })()",
			"undefined",
		]) {
			const result = await run("browser_evaluate", { expression });
			assert.equal(typeof result.content[0].text, "string");
			assert.doesNotThrow(() => JSON.stringify(result.details));
		}
	});

	it("bounds evaluate output and does not retain the unbounded value in details", async () => {
		await goto("/");
		const result = await run("browser_evaluate", { expression: '"x".repeat(100000)' });
		assert.match(result.content[0].text, /Output truncated/);
		assert.equal(result.details.result, result.content[0].text);
		assert.ok(result.content[0].text.length < 51_000);
	});

	it("cancels a pending promise and can reconnect afterward", async () => {
		await goto("/");
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 100);
		try {
			await assert.rejects(
				run("browser_evaluate", { expression: "new Promise(() => {})" }, controller.signal),
				{ name: "AbortError" }
			);
		} finally {
			clearTimeout(timer);
		}
		assert.equal((await run("browser_evaluate", { expression: "6 * 7" })).details.result, 42);
	});

	it("interrupts a JavaScript infinite loop without killing Chrome", async () => {
		await goto("/");
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 100);
		try {
			await assert.rejects(
				run(
					"browser_evaluate",
					{ expression: "(() => { while (true) {} })()" },
					controller.signal
				),
				{ name: "AbortError" }
			);
		} finally {
			clearTimeout(timer);
		}
		assert.equal((await run("browser_evaluate", { expression: "6 * 7" })).details.result, 42);
	});

	it("rejects with the page error text on thrown errors", async () => {
		await goto("/");
		await assert.rejects(
			run("browser_evaluate", { expression: `(() => { throw new Error("boom") })()` }),
			/boom/
		);
	});

	it("rejects on a syntax error in the expression", async () => {
		await goto("/");
		await assert.rejects(
			run("browser_evaluate", { expression: "(() => {" }),
			/browser_evaluate failed.*(Syntax|syntax)/i
		);
	});
});
