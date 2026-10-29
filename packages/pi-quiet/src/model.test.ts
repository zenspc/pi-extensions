import assert from "node:assert/strict";
import { test } from "node:test";
import { hasProse, QuietModel } from "./model.ts";

const result = (text = "hello") => ({
	content: [{ type: "text" as const, text }],
	details: undefined,
});
function settle(model: QuietModel, id: string, tool = "read", error = false) {
	model.start(id, tool, { path: `${id}.ts` });
	model.end(id, tool, result(), error);
}

test("strict neighbors fold with a last-member carrier; pending and failed rows remain visible", () => {
	const model = new QuietModel();
	settle(model, "a");
	settle(model, "b");
	assert.equal(model.isHidden("a"), true);
	assert.deepEqual(
		model.members("b").map((r) => r.id),
		["a", "b"]
	);
	model.start("c", "read");
	assert.equal(model.members("b").length, 2);
	assert.equal(model.isHidden("c"), false);
	model.end("c", "read", result("error"), true);
	settle(model, "d");
	settle(model, "e");
	assert.deepEqual(
		model.members("e").map((r) => r.id),
		["d", "e"]
	);
	assert.equal(model.members("c").length, 1);
});

test("parallel completion never changes call ordering and invalidates old carriers", () => {
	const model = new QuietModel();
	for (const id of ["a", "b", "c"]) model.start(id, "read", { path: id });
	let invalidations = 0;
	model.watch("b", () => invalidations++);
	model.end("b", "read", result(), false);
	model.end("a", "read", result(), false);
	assert.equal(model.members("b").length, 2);
	model.end("c", "read", result(), false);
	assert.deepEqual(
		model.members("c").map((row) => row.id),
		["a", "b", "c"]
	);
	assert.equal(model.isHidden("b"), true);
	assert.ok(invalidations >= 2);
	model.start("a", "read", { path: "changed" });
	assert.equal(model.get("a")?.outcome?.kind, "success");
	assert.equal(model.get("a")?.args.path, "a");
});

test("mixed searches fold; mutations, foreign tools, kind changes and prose split runs", () => {
	const model = new QuietModel();
	settle(model, "a", "grep");
	settle(model, "b", "find");
	assert.equal(model.members("b").length, 2);
	for (const tool of ["edit", "write", "bash", "foreign"]) {
		settle(model, `${tool}1`, tool);
		settle(model, `${tool}2`, tool);
		assert.equal(model.members(`${tool}2`).length, 1);
	}
	settle(model, "r1");
	model.boundary();
	settle(model, "r2");
	assert.equal(model.members("r2").length, 1);
	settle(model, "ls", "ls");
	assert.equal(model.members("ls").length, 1);
});

test("images stay singleton so Pi retains ownership of inline image rendering", () => {
	const model = new QuietModel();
	settle(model, "a");
	model.start("image", "read");
	model.end(
		"image",
		"read",
		{
			content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
			details: undefined,
		},
		false
	);
	settle(model, "b");
	assert.equal(model.members("image").length, 1);
	assert.equal(model.members("b").length, 1);
});

test("history rebuild follows the active transcript and handles missing results and malformed entries", () => {
	const model = new QuietModel();
	const call = (id: string, name = "read") => ({
		type: "toolCall",
		id,
		name,
		arguments: { path: `${id}.ts` },
	});
	const end = (id: string, toolName = "read") => ({
		role: "toolResult",
		toolCallId: id,
		toolName,
		...result(),
	});
	const messages = [
		null,
		{ role: "user", content: "Start" },
		{ role: "assistant", content: [call("a"), call("b")] },
		end("b"),
		end("a"),
		{ role: "assistant", content: [call("c")] },
		end("c"),
		{
			role: "assistant",
			content: [{ type: "text", text: "Next" }, call("d")],
		},
		end("d"),
		{ role: "assistant", content: [call("interrupted")] },
	];
	model.rebuild(messages);
	assert.deepEqual(
		model.members("c").map((r) => r.id),
		["a", "b", "c"]
	);
	assert.equal(model.members("d").length, 1);
	assert.equal(model.get("interrupted")?.outcome?.chip, "interrupted");
	model.rebuild([
		{ role: "assistant", content: [call("fresh")] },
		end("fresh"),
	]);
	assert.equal(model.get("a"), undefined);
	assert.equal(model.members("fresh").length, 1);
	assert.equal(
		hasProse({
			content: [{ type: "thinking", thinking: "Consider this" }],
		}),
		true
	);
	assert.equal(hasProse({ content: [{ type: "toolCall" }] }), false);
});

test("only groupable tools retain result references and clear discards callbacks", () => {
	const model = new QuietModel();
	settle(model, "bash", "bash");
	assert.equal(model.get("bash")?.result, undefined);
	let calls = 0;
	model.watch("bash", () => calls++);
	model.clear();
	model.invalidate();
	assert.equal(calls, 0);
});
