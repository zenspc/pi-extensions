import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyScrollAction,
	clampScrollOffset,
	scrollActionForInput,
	scrollRangeLabel,
} from "./context-scroll.mjs";

describe("clampScrollOffset", () => {
	it("clamps to zero when content fits", () => {
		assert.equal(clampScrollOffset(5, 10, 20), 0);
		assert.equal(clampScrollOffset(-3, 10, 20), 0);
	});

	it("clamps to max scroll when content overflows", () => {
		assert.equal(clampScrollOffset(100, 50, 10), 40);
		assert.equal(clampScrollOffset(0, 50, 10), 0);
		assert.equal(clampScrollOffset(12, 50, 10), 12);
	});

	it("handles non-finite input as zero", () => {
		assert.equal(clampScrollOffset(Number.NaN, 50, 10), 0);
		assert.equal(clampScrollOffset(Number.POSITIVE_INFINITY, 50, 10), 0);
		assert.equal(clampScrollOffset(Number.NEGATIVE_INFINITY, 50, 10), 0);
	});
});

describe("scrollActionForInput", () => {
	it("maps line scroll keys", () => {
		assert.deepEqual(scrollActionForInput("k", 5), { type: "delta", lines: -1 });
		assert.deepEqual(scrollActionForInput("j", 5), { type: "delta", lines: 1 });
		assert.deepEqual(scrollActionForInput("K", 5), { type: "delta", lines: -1 });
		assert.deepEqual(scrollActionForInput("J", 5), { type: "delta", lines: 1 });
		assert.deepEqual(scrollActionForInput("\x10", 5), { type: "delta", lines: -1 }); // ctrl+p
		assert.deepEqual(scrollActionForInput("\x0e", 5), { type: "delta", lines: 1 }); // ctrl+n
		assert.deepEqual(scrollActionForInput("\x1b[A", 5), { type: "delta", lines: -1 });
		assert.deepEqual(scrollActionForInput("\x1b[B", 5), { type: "delta", lines: 1 });
	});

	it("maps page scroll relative to pageSize", () => {
		assert.deepEqual(scrollActionForInput("\x1b[5~", 7), { type: "delta", lines: -7 });
		assert.deepEqual(scrollActionForInput("\x1b[6~", 7), { type: "delta", lines: 7 });
	});

	it("maps home/end and g/G", () => {
		assert.deepEqual(scrollActionForInput("g", 5), { type: "home" });
		assert.deepEqual(scrollActionForInput("G", 5), { type: "end" });
		assert.deepEqual(scrollActionForInput("\x1b[H", 5), { type: "home" });
		assert.deepEqual(scrollActionForInput("\x1b[F", 5), { type: "end" });
	});

	it("uses matchesKey when provided", () => {
		const matches = (data, key) => data === "CUSTOM" && key === "pageDown";
		assert.deepEqual(scrollActionForInput("CUSTOM", 4, matches), { type: "delta", lines: 4 });
	});

	it("returns null for unrelated keys", () => {
		assert.equal(scrollActionForInput("e", 5), null);
		assert.equal(scrollActionForInput(" ", 5), null);
		assert.equal(scrollActionForInput("\x1b", 5), null);
	});
});

describe("applyScrollAction", () => {
	it("applies deltas with clamping", () => {
		assert.equal(applyScrollAction({ type: "delta", lines: 3 }, 0, 50, 10), 3);
		assert.equal(applyScrollAction({ type: "delta", lines: 100 }, 0, 50, 10), 40);
		assert.equal(applyScrollAction({ type: "delta", lines: -5 }, 2, 50, 10), 0);
	});

	it("jumps home and end", () => {
		assert.equal(applyScrollAction({ type: "home" }, 12, 50, 10), 0);
		assert.equal(applyScrollAction({ type: "end" }, 0, 50, 10), 40);
		assert.equal(applyScrollAction({ type: "end" }, 0, 5, 10), 0);
	});
});

describe("scrollRangeLabel", () => {
	it("formats visible range", () => {
		assert.equal(scrollRangeLabel(0, 10, 50), "1-10/50");
		assert.equal(scrollRangeLabel(40, 10, 50), "41-50/50");
		assert.equal(scrollRangeLabel(0, 10, 0), "0/0");
	});
});
