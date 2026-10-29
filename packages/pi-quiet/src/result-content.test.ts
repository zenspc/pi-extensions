import assert from "node:assert/strict";
import { test } from "node:test";
import {
	resultIsImageFromContent,
	resultTextFromContent,
} from "./result-content.ts";

test("content extraction includes all text blocks and ignores malformed blocks", () => {
	assert.equal(
		resultTextFromContent([
			null,
			{ type: "text", text: 42 },
			{ type: "text", text: "first" },
			{ type: "image" },
			{ type: "text", text: "second" },
		]),
		"first\nsecond"
	);
	assert.equal(resultTextFromContent("legacy text"), "legacy text");
	assert.equal(resultTextFromContent({ content: "invalid" }), "");
	assert.equal(resultIsImageFromContent([null, { type: "image" }]), true);
	assert.equal(resultIsImageFromContent(null), false);
});
