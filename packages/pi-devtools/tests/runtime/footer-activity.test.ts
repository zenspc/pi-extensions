import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { createFooterActivity } from "../../extensions/footer/activity.ts";

function activity(t: TestContext, branch: any[] = [], idle = true) {
	const handlers = new Map<string, Function[]>();
	let renders = 0;
	const tracker = createFooterActivity(
		{
			on(name: string, fn: Function) {
				handlers.set(name, [...(handlers.get(name) ?? []), fn]);
				return () =>
					handlers.set(
						name,
						(handlers.get(name) ?? []).filter(
							(handler) => handler !== fn
						)
					);
			},
		} as any,
		{
			isIdle: () => idle,
			sessionManager: { getBranch: () => branch },
		} as any,
		() => {
			renders++;
		}
	);
	t.after(() => tracker.dispose());
	return {
		tracker,
		render: () =>
			tracker.renderTimer({
				fg: (color: string, text: string) => `${color}:${text}`,
			} as any),
		async emit(name: string, event = {}) {
			for (const handler of handlers.get(name) ?? [])
				await handler(event);
		},
		get renders() {
			return renders;
		},
		get handlers() {
			return [...handlers.values()].reduce(
				(count, list) => count + list.length,
				0
			);
		},
	};
}

function retention(t: TestContext, value?: string) {
	const previous = process.env.PI_CACHE_RETENTION;
	if (value === undefined) delete process.env.PI_CACHE_RETENTION;
	else process.env.PI_CACHE_RETENTION = value;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CACHE_RETENTION;
		else process.env.PI_CACHE_RETENTION = previous;
	});
}

const assistant = { role: "assistant", usage: { output: 10 } };

describe("shared footer activity timer", () => {
	it("shows live, counts idle time with freshness colors, caps at TTL, and restarts after another response", async (t) => {
		retention(t);
		t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
		const app = activity(t);
		assert.equal(app.render(), "");
		t.mock.timers.tick(1000);
		assert.equal(app.renders, 0);
		await app.emit("agent_start");
		await app.emit("message_start", { message: assistant });
		assert.equal(app.render(), "muted:live");
		t.mock.timers.tick(1000);
		await app.emit("message_end", { message: assistant });
		assert.equal(app.tracker.speed, 10);
		assert.equal(app.render(), "muted:live");
		await app.emit("agent_end");
		assert.equal(app.render(), "success:0s");
		t.mock.timers.tick(30_000);
		assert.equal(app.render(), "success:30s");
		t.mock.timers.tick(120_000);
		assert.equal(app.render(), "warning:2m30s");
		t.mock.timers.tick(150_000);
		assert.equal(app.render(), "error:5m00s");
		const expired = app.renders;
		t.mock.timers.tick(60_000);
		assert.equal(app.renders, expired);
		assert.equal(app.render(), "error:5m00s");
		await app.emit("message_end", { message: assistant });
		assert.equal(app.render(), "success:0s");
		const restarted = app.renders;
		t.mock.timers.tick(1000);
		assert.equal(app.renders, restarted + 1);
		assert.equal(app.render(), "success:1s");
	});

	it("seeds from resumed history, ignores non-assistant events, and stops all work on disposal", async (t) => {
		retention(t);
		t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
		const app = activity(t, [
			{
				type: "message",
				message: assistant,
				timestamp: new Date(970_000).toISOString(),
			},
		]);
		assert.equal(app.render(), "success:30s");
		await app.emit("message_start", { message: { role: "user" } });
		await app.emit("message_end", { message: { role: "toolResult" } });
		assert.equal(app.render(), "success:30s");
		t.mock.timers.tick(1000);
		assert.equal(app.render(), "success:31s");
		assert.equal(app.renders, 1);
		app.tracker.dispose();
		app.tracker.dispose();
		assert.equal(app.handlers, 0);
		t.mock.timers.tick(1000);
		assert.equal(app.renders, 1);
	});

	it("does not tick for expired or invalid history and shows live when mounted during an active run", (t) => {
		retention(t);
		t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
		const cold = activity(t, [
			{ type: "message", message: assistant, timestamp: 0 },
		]);
		const invalid = activity(t, [
			{ type: "message", message: assistant, timestamp: "invalid" },
		]);
		const active = activity(t, [], false);
		assert.equal(cold.render(), "error:5m00s");
		assert.equal(invalid.render(), "");
		assert.equal(active.render(), "muted:live");
		t.mock.timers.tick(1000);
		assert.equal(cold.renders + invalid.renders + active.renders, 0);
	});

	it("uses the one-hour TTL in long-retention mode", (t) => {
		retention(t, "long");
		t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
		const app = activity(t, [
			{ type: "message", message: assistant, timestamp: Date.now() },
		]);
		t.mock.timers.tick(30 * 60 * 1000);
		assert.equal(app.render(), "warning:30m00s");
		t.mock.timers.tick(30 * 60 * 1000);
		assert.equal(app.render(), "error:1h00m");
		const stopped = app.renders;
		t.mock.timers.tick(1000);
		assert.equal(app.renders, stopped);
	});
});
