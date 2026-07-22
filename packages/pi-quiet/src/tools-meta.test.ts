import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	FOREIGN_KIND_EMOJI,
	foreignToolsQuietEnabled,
	isQuietToolName,
	setForeignToolsQuiet,
	toolParticipatesInQuiet,
	verbGroupJoins,
	verbGroupKind,
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

describe("verbGroupKind", () => {
	it("maps tools to semantic kinds", () => {
		assert.equal(verbGroupKind("read"), "file");
		assert.equal(verbGroupKind("grep"), "search");
		assert.equal(verbGroupKind("find"), "search");
		assert.equal(verbGroupKind("ls"), "dir");
		assert.equal(verbGroupKind("bash"), "command");
		assert.equal(verbGroupKind("edit"), "editFile");
		assert.equal(verbGroupKind("write"), "editFile");
		assert.equal(verbGroupKind("mcp"), "other");
	});

	it("only explore + other kinds join Verb Groups", () => {
		assert.equal(verbGroupJoins("file"), true);
		assert.equal(verbGroupJoins("search"), true);
		assert.equal(verbGroupJoins("dir"), true);
		assert.equal(verbGroupJoins("other"), true);
		assert.equal(verbGroupJoins("command"), false);
		assert.equal(verbGroupJoins("editFile"), false);
	});
});
