import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import extension from "./index.ts";
import { createTestBrowser, startTestApp } from "./test-support.ts";

type Tool = ToolDefinition<TSchema, unknown>;
const HTML = `<!doctype html><html><head><title>Controls</title></head>
<body style="min-height:2400px"><form onsubmit="event.preventDefault();document.querySelector('#result').textContent='Saved '+document.querySelector('input').value">
<label>Name <input></label><button>Save</button></form><p id="result">Ready</p>
<label>Country <select onchange="document.querySelector('#country').textContent=this.value"><option value="in">India</option><option value="jp">Japan</option></select></label><p id="country">in</p>
<button onclick="setTimeout(()=>document.querySelector('#loaded').hidden=false,100)">Load</button><p id="loaded" hidden>Loaded result</p>
<div role="region" aria-label="Scrollable list" tabindex="0" style="height:100px;overflow:auto"><div style="height:1000px">Nested content</div></div>
</body></html>`;

function text(result: Awaited<ReturnType<Tool["execute"]>>): string {
	return result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}

function refFor(output: string, name: string): string {
	const line = output.split("\n").find((line) => line.includes(name));
	const match = line && /\[ref=(e\d+)\]/.exec(line);
	assert.ok(match, `Missing Element Ref for ${name}: ${output}`);
	return match[1];
}

describe("core browser controls", () => {
	let browser: ReturnType<typeof createTestBrowser>;
	let app: Awaited<ReturnType<typeof startTestApp>>;
	let tools: Map<string, Tool>;
	let denied: Map<string, Tool>;

	function load(allowlistPath: string): Map<string, Tool> {
		const registered = new Map<string, Tool>();
		extension({
			registerTool: (tool: Tool) => registered.set(tool.name, tool),
			registerCommand() {},
			on() {},
		} as unknown as ExtensionAPI, {
			attachment: browser.attachment,
			allowlistPath,
			availabilityPath: `${allowlistPath}.availability`,
		});
		return registered;
	}

	async function run(name: string, params: Record<string, unknown> = {}, source = tools) {
		const tool = source.get(name);
		assert.ok(tool, `${name} must be registered`);
		return tool.execute("test", params, undefined, undefined, undefined as never);
	}

	before(async () => {
		browser = createTestBrowser();
		app = await startTestApp((_req, res) => {
			res.setHeader("content-type", "text/html");
			res.end(HTML);
		});
		const allowlist = join(browser.dir, "allow.json");
		writeFileSync(allowlist, JSON.stringify({ version: 1, domains: ["127.0.0.1"] }));
		tools = load(allowlist);
		denied = load(join(browser.dir, "denied.json"));
	});
	after(async () => {
		await browser?.close();
		await app?.close();
	});

	async function navigate() {
		return run("browser_navigate", { url: `http://127.0.0.1:${app.port}/` });
	}

	it("returns page observations after navigation, typing, and clicking", async () => {
		const first = text(await navigate());
		assert.match(first, /textbox "Name"/);
		assert.match(first, /Viewport: \d+x\d+/);
		const filled = text(await run("browser_type", { ref: refFor(first, 'textbox "Name"'), text: "Pi" }));
		assert.match(filled, /button "Save"/);
		const clicked = text(await run("browser_click", { ref: refFor(filled, 'button "Save"') }));
		assert.match(clicked, /Saved Pi/);
	});

	it("presses Enter on a referenced field and returns the result", async () => {
		const first = text(await navigate());
		const ref = refFor(first, 'textbox "Name"');
		await run("browser_type", { ref, text: "Keyboard" });
		const result = await run("browser_press", { ref, key: "Enter" });
		assert.match(text(result), /Saved Keyboard/);
		await assert.rejects(run("browser_press", { ref: "e999999999", key: "Enter" }), /stale Element Ref/);
	});

	it("exposes dropdown choices and selects by value", async () => {
		const first = text(await navigate());
		assert.match(first, /option "Japan".*value="jp"/);
		const selected = text(await run("browser_select", { ref: refFor(first, 'combobox "Country"'), values: ["jp"] }));
		assert.match(selected, /option "Japan".*\[selected\]/);
		assert.equal(await browser.attachment.withTab((tab) => tab.locator("select").inputValue()), "jp");
	});

	it("scrolls the document and a referenced nested scroll container", async () => {
		const first = text(await navigate());
		await run("browser_scroll", { direction: "down", pixels: 400 });
		assert.ok(await browser.attachment.withTab((tab) => tab.evaluate(() => scrollY > 0)));
		await run("browser_scroll", { ref: refFor(first, 'region "Scrollable list"'), direction: "down", pixels: 200 });
		assert.equal(await browser.attachment.withTab((tab) => tab.locator('[role="region"]').evaluate((el) => el.scrollTop)), 200);
	});

	it("waits for visible text instead of requiring arbitrary sleeps", async () => {
		const first = text(await navigate());
		await run("browser_click", { ref: refFor(first, 'button "Load"') });
		assert.match(text(await run("browser_wait", { text: "Loaded result", timeoutMs: 2000 })), /Loaded result/);
		await assert.rejects(run("browser_wait", { text: "Never appears", timeoutMs: 50 }), /Timeout/);
	});

	it("does not replay a completed action when its follow-up Snapshot fails", async () => {
		const first = text(await navigate());
		await browser.attachment.withTab((tab) => tab.locator("button").first().evaluate((button) => {
			button.addEventListener("click", () => {
				document.body.dataset.clicks = String(Number(document.body.dataset.clicks ?? 0) + 1);
				window.getComputedStyle = () => { throw new Error("Snapshot unavailable"); };
			});
		}));
		const result = await run("browser_click", { ref: refFor(first, 'button "Save"') });
		assert.match(text(result), /Action completed.*Snapshot failed/);
		assert.match(text(result), /do not repeat the action/);
		assert.equal(await browser.attachment.withTab((tab) => tab.evaluate(() => document.body.dataset.clicks)), "1");
	});

	it("keeps screenshots and actions on a native, non-emulated viewport", async () => {
		await navigate();
		const before = await browser.attachment.withTab((tab) => {
			assert.equal(tab.viewportSize(), null);
			return tab.evaluate(() => ({ width: innerWidth, height: innerHeight }));
		});
		await run("browser_screenshot");
		const after = await browser.attachment.withTab((tab) => tab.evaluate(() => ({ width: innerWidth, height: innerHeight })));
		assert.deepEqual(after, before);
	});

	it("rechecks domain approval for every new control before execution", async () => {
		const first = text(await navigate());
		for (const [name, params] of [
			["browser_press", { key: "Enter" }],
			["browser_scroll", { direction: "down" }],
			["browser_wait", { text: "Ready" }],
			["browser_select", { ref: refFor(first, 'combobox "Country"'), values: ["jp"] }],
		] satisfies [string, Record<string, unknown>][]) {
			await assert.rejects(run(name, params, denied), /not approved/);
		}
	});

});
