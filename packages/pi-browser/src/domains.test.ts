import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyUrl, registrableDomain } from "./domains.ts";

describe("registrableDomain", () => {
	it("computes Registrable Domain from the Public Suffix List", () => {
		assert.equal(registrableDomain("example.com"), "example.com");
		assert.equal(registrableDomain("a.b.example.com"), "example.com");
		assert.equal(registrableDomain("deep.sub.example.dev"), "example.dev");
		assert.equal(registrableDomain("example.co.uk"), "example.co.uk");
		assert.equal(registrableDomain("app.example.co.uk"), "example.co.uk");
		assert.equal(registrableDomain("foo.github.io"), "foo.github.io");
	});

	it("gives no domain for a public suffix", () => {
		assert.equal(registrableDomain("github.io"), undefined);
		assert.equal(registrableDomain("co.uk"), undefined);
	});

	it("strips www via the PSL, not a leading-label rule", () => {
		assert.equal(registrableDomain("www.example.com"), "example.com");
		assert.equal(registrableDomain("www.app.example.com"), "example.com");
		assert.equal(registrableDomain("www.gov.uk"), "www.gov.uk");
		assert.equal(registrableDomain("www.com"), "www.com");
	});

	it("normalizes case and trailing dots", () => {
		assert.equal(registrableDomain("EXAMPLE.Com."), "example.com");
		assert.equal(registrableDomain("WWW.EXAMPLE.CO.UK"), "example.co.uk");
		assert.equal(registrableDomain("FOO.GITHUB.IO."), "foo.github.io");
	});

	it("uses the hostname for IPs and single-label hosts", () => {
		assert.equal(registrableDomain("localhost"), "localhost");
		assert.equal(registrableDomain("127.0.0.1"), "127.0.0.1");
		assert.equal(registrableDomain("::1"), "::1");
		assert.equal(registrableDomain("[::1]"), "::1");
		assert.equal(registrableDomain("example.localhost"), "example.localhost");
	});

	it("returns undefined for empty input", () => {
		assert.equal(registrableDomain(""), undefined);
	});
});

describe("classifyUrl", () => {
	it("classifies http(s) sites by Registrable Domain", () => {
		assert.deepEqual(classifyUrl(new URL("https://a.b.example.com/x")), {
			kind: "site",
			domain: "example.com",
		});
		assert.deepEqual(classifyUrl(new URL("http://foo.github.io/")), {
			kind: "site",
			domain: "foo.github.io",
		});
		assert.deepEqual(classifyUrl(new URL("http://127.0.0.1:8080/")), {
			kind: "site",
			domain: "127.0.0.1",
		});
		assert.deepEqual(classifyUrl(new URL("http://localhost/")), {
			kind: "site",
			domain: "localhost",
		});
		assert.deepEqual(classifyUrl(new URL("https://www.example.com/")), {
			kind: "site",
			domain: "example.com",
		});
	});

	it("does not split a site by scheme or port", () => {
		assert.deepEqual(classifyUrl(new URL("https://example.com:8443/a")), {
			kind: "site",
			domain: "example.com",
		});
		assert.deepEqual(classifyUrl(new URL("http://example.com:8080/b")), {
			kind: "site",
			domain: "example.com",
		});
	});

	it("allows about:blank and blocks other about URLs", () => {
		assert.deepEqual(classifyUrl(new URL("about:blank")), { kind: "blank" });
		assert.deepEqual(classifyUrl(new URL("about:blank#keep")), { kind: "blank" });
		assert.deepEqual(classifyUrl(new URL("about:srcdoc")), { kind: "blocked" });
	});

	it("blocks non-http(s) schemes and public suffixes", () => {
		for (const href of [
			"file:///tmp/x",
			"data:text/html,hi",
			"javascript:alert(1)",
			"blob:https://example.com/uuid",
			"chrome://settings",
			"https://github.io/",
		]) {
			assert.equal(classifyUrl(new URL(href)).kind, "blocked", href);
		}
	});
});
