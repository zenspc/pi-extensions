import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyBashOutcome,
	classifyEditOutcome,
	classifyExploreOutcome,
	classifyReadOutcome,
	classifyWriteOutcome,
	diffLineStats,
	textLineCount,
} from "./classify.ts";

describe("textLineCount / diffLineStats", () => {
	it("counts non-empty lines", () => {
		assert.equal(textLineCount(""), 0);
		assert.equal(textLineCount("a\nb\n"), 2);
		assert.equal(textLineCount("a\n\nb"), 2);
	});

	it("counts added/removed diff lines excluding headers", () => {
		const diff = [
			"--- a/x",
			"+++ b/x",
			"@@ -1,3 +1,4 @@",
			" context",
			"-old",
			"+new",
			"+more",
		].join("\n");
		assert.deepEqual(diffLineStats(diff), { added: 2, removed: 1 });
	});
});

describe("classifyReadOutcome", () => {
	it("pending while partial", () => {
		assert.deepEqual(classifyReadOutcome({ isPartial: true, isError: false, text: "" }), {
			kind: "pending",
		});
	});

	it("hard on error", () => {
		const out = classifyReadOutcome({
			isPartial: false,
			isError: true,
			text: "Error: EACCES",
		});
		assert.equal(out.kind, "hard");
		assert.match(out.chip ?? "", /failed/i);
	});

	it("success chip with line count", () => {
		assert.deepEqual(
			classifyReadOutcome({
				isPartial: false,
				isError: false,
				text: "a\nb\nc",
				isImage: false,
			}),
			{ kind: "success", chip: "3 lines" },
		);
	});

	it("success for images", () => {
		assert.deepEqual(
			classifyReadOutcome({
				isPartial: false,
				isError: false,
				text: "",
				isImage: true,
			}),
			{ kind: "success", chip: "image" },
		);
	});
});

describe("classifyExploreOutcome", () => {
	it("soft breakthrough on zero matches", () => {
		assert.deepEqual(
			classifyExploreOutcome({
				tool: "grep",
				isPartial: false,
				isError: false,
				text: "",
			}),
			{ kind: "soft", chip: "0 matches" },
		);
		assert.deepEqual(
			classifyExploreOutcome({
				tool: "find",
				isPartial: false,
				isError: false,
				text: "\n",
			}),
			{ kind: "soft", chip: "0 files" },
		);
	});

	it("success with counts", () => {
		assert.deepEqual(
			classifyExploreOutcome({
				tool: "grep",
				isPartial: false,
				isError: false,
				text: "a.ts:1\nb.ts:2\n",
			}),
			{ kind: "success", chip: "2 matches" },
		);
		assert.deepEqual(
			classifyExploreOutcome({
				tool: "ls",
				isPartial: false,
				isError: false,
				text: "a\nb\nc",
			}),
			{ kind: "success", chip: "3 entries" },
		);
	});

	it("hard on error", () => {
		assert.equal(
			classifyExploreOutcome({
				tool: "ls",
				isPartial: false,
				isError: true,
				text: "no such file",
			}).kind,
			"hard",
		);
	});
});

describe("classifyBashOutcome", () => {
	it("success exit 0 hides stdout", () => {
		assert.deepEqual(
			classifyBashOutcome({
				isPartial: false,
				isError: false,
				text: "hello\nworld\n",
			}),
			{ kind: "success", chip: "exit 0" },
		);
	});

	it("soft on empty successful stdout", () => {
		assert.deepEqual(
			classifyBashOutcome({
				isPartial: false,
				isError: false,
				text: "",
			}),
			{ kind: "soft", chip: "exit 0 · empty" },
		);
	});

	it("hard when isError (non-zero exit throws in pi)", () => {
		const out = classifyBashOutcome({
			isPartial: false,
			isError: true,
			text: "boom\nCommand exited with code 1",
		});
		assert.equal(out.kind, "hard");
		assert.match(out.chip ?? "", /exit|failed/i);
	});
});

describe("classifyEditOutcome / classifyWriteOutcome", () => {
	it("edit success uses diff stats", () => {
		const diff = "-a\n+b\n+c\n";
		assert.deepEqual(
			classifyEditOutcome({
				isPartial: false,
				isError: false,
				diff,
				text: "",
			}),
			{ kind: "success", chip: "+2 -1" },
		);
	});

	it("edit hard on error", () => {
		assert.equal(
			classifyEditOutcome({
				isPartial: false,
				isError: true,
				text: "oldText not found",
			}).kind,
			"hard",
		);
	});

	it("write success reports line count from args content", () => {
		assert.deepEqual(
			classifyWriteOutcome({
				isPartial: false,
				isError: false,
				contentLineCount: 10,
				text: "",
			}),
			{ kind: "success", chip: "10 lines" },
		);
	});
});
