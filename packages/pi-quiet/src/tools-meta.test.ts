import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	FOREIGN_KIND_EMOJI,
	foreignToolsQuietEnabled,
	isQuietToolName,
	setForeignToolsQuiet,
	toolParticipatesInQuiet,
} from "./tools-meta.ts";

afterEach(() => {
	setForeignToolsQuiet(false);
});

describe("toolParticipatesInQuiet", () => {
	it("built-ins always participate", () => {
		assert.equal(toolParticipatesInQuiet("read"), true);
		assert.equal(isQuietToolName("read"), true);
		assert.equal(toolParticipatesInQuiet("mcp"), false);
		assert.equal(foreignToolsQuietEnabled(), false);
	});

	it("Foreign Tools participate only when enabled", () => {
		setForeignToolsQuiet(true);
		assert.equal(foreignToolsQuietEnabled(), true);
		assert.equal(toolParticipatesInQuiet("mcp"), true);
		assert.equal(toolParticipatesInQuiet("subagent"), true);
		assert.equal(toolParticipatesInQuiet(""), false);
	});

	it("exports the Foreign Kind Emoji", () => {
		assert.equal(FOREIGN_KIND_EMOJI, "🧩");
	});
});
