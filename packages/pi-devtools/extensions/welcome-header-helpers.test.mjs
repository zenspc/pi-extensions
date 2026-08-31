import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	captureIsComplete,
	emptyWelcomeResources,
	getSectionHeading,
	isSectionId,
	parseResourceSections,
	splitCommaItems,
} from "./welcome-header-helpers.mjs";

function section(title, body) {
	return `[${title}]\n${body}`;
}

describe("isSectionId", () => {
	it("accepts known resource headings", () => {
		for (const id of ["Context", "Skills", "Prompts", "Extensions", "Themes"]) {
			assert.equal(isSectionId(id), true);
		}
	});

	it("rejects unknown headings", () => {
		assert.equal(isSectionId("Tools"), false);
		assert.equal(isSectionId("skills"), false);
	});
});

describe("getSectionHeading", () => {
	it("reads a bracket heading from the first line", () => {
		assert.equal(getSectionHeading(section("Skills", "foo, bar")), "Skills");
	});

	it("strips ansi before matching", () => {
		assert.equal(getSectionHeading("\x1B[1m[Themes]\x1B[0m\ndracula"), "Themes");
	});

	it("ignores non-heading text", () => {
		assert.equal(getSectionHeading("Skills"), undefined);
		assert.equal(getSectionHeading("[Skills"), undefined);
	});
});

describe("splitCommaItems", () => {
	it("skips the heading and splits the body", () => {
		assert.deepEqual(splitCommaItems(section("Skills", "  foo, bar, baz")), [
			"foo",
			"bar",
			"baz",
		]);
	});

	it("dedupes and drops empty parts", () => {
		assert.deepEqual(splitCommaItems(section("Skills", "foo,, foo,  bar")), [
			"foo",
			"bar",
		]);
	});
});

describe("parseResourceSections", () => {
	it("maps known sections and ignores unknown headings", () => {
		const resources = parseResourceSections([
			section("Skills", "grill, ponytail"),
			section("Extensions", "welcome-header, custom-footer"),
			section("Tools", "read, bash"),
		]);
		assert.deepEqual(resources.skills, ["grill", "ponytail"]);
		assert.deepEqual(resources.extensions, ["welcome-header", "custom-footer"]);
		assert.deepEqual(resources.context, []);
		assert.deepEqual(resources.prompts, []);
		assert.deepEqual(resources.themes, []);
	});
});

describe("captureIsComplete", () => {
	it("is true when this extension is listed", () => {
		const resources = emptyWelcomeResources();
		resources.extensions = ["cd-command", "welcome-header"];
		assert.equal(captureIsComplete(resources), true);
		resources.extensions = ["packages/pi-devtools/extensions/welcome-header.ts"];
		assert.equal(captureIsComplete(resources), true);
		resources.extensions = ["@zenspc/pi-devtools/welcome-header"];
		assert.equal(captureIsComplete(resources), true);
	});

	it("is false until welcome-header appears", () => {
		const resources = emptyWelcomeResources();
		resources.extensions = ["custom-footer", "cd-command"];
		assert.equal(captureIsComplete(resources), false);
	});
});
