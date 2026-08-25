import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registrableDomain } from "./domains.ts";

describe("registrableDomain", () => {
	it("reduces hosts to their last two labels by default", () => {
		assert.equal(registrableDomain("example.com"), "example.com");
		assert.equal(registrableDomain("a.b.example.com"), "example.com");
		assert.equal(registrableDomain("deep.sub.example.dev"), "example.dev");
	});

	it("keeps three labels for known two-part suffixes", () => {
		assert.equal(registrableDomain("example.co.uk"), "example.co.uk");
		assert.equal(registrableDomain("app.example.co.uk"), "example.co.uk");
		assert.equal(registrableDomain("www.example.com.au"), "example.com.au");
		assert.equal(registrableDomain("shop.example.co.jp"), "example.co.jp");
		assert.equal(registrableDomain("lists.org.uk"), "lists.org.uk");
	});

	it("strips a leading www label before reducing", () => {
		assert.equal(registrableDomain("www.example.com"), "example.com");
		assert.equal(registrableDomain("www.app.example.com"), "example.com");
	});

	it("normalizes case and trailing dots", () => {
		assert.equal(registrableDomain("EXAMPLE.Com."), "example.com");
		assert.equal(registrableDomain("WWW.EXAMPLE.CO.UK"), "example.co.uk");
	});

	it("passes through single and two-label hosts", () => {
		assert.equal(registrableDomain("localhost"), "localhost");
		assert.equal(registrableDomain("example.localhost"), "example.localhost");
	});

	it("returns empty for empty input", () => {
		assert.equal(registrableDomain(""), "");
	});
});
