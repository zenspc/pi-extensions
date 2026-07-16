import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import { parseReleaseTag, resolvePackageDir } from "./parse-release-tag.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";

describe("parseReleaseTag", () => {
  it("parses package tag", () => {
    assert.deepEqual(parseReleaseTag("@zenspc/pi-safety@0.1.0"), {
      packageName: "@zenspc/pi-safety",
      version: "0.1.0",
    });
  });

  it("parses prerelease", () => {
    assert.deepEqual(parseReleaseTag("@zenspc/pi-copilot-discovery@0.3.2-rc.1"), {
      packageName: "@zenspc/pi-copilot-discovery",
      version: "0.3.2-rc.1",
    });
  });

  it("strips refs/tags/", () => {
    assert.deepEqual(parseReleaseTag("refs/tags/@zenspc/pi-devtools@1.2.3"), {
      packageName: "@zenspc/pi-devtools",
      version: "1.2.3",
    });
  });

  it("rejects bad tags", () => {
    assert.throws(() => parseReleaseTag("v0.1.0"), /invalid release tag/);
    assert.throws(() => parseReleaseTag("@zenspc/pi-safety"), /invalid release tag/);
    assert.throws(() => parseReleaseTag(""), /non-empty/);
  });
});

describe("resolvePackageDir", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-"));
  const packagesDir = join(root, "packages");
  mkdirSync(join(packagesDir, "pi-safety"), { recursive: true });
  writeFileSync(
    join(packagesDir, "pi-safety", "package.json"),
    JSON.stringify({ name: "@zenspc/pi-safety", version: "0.1.0" }),
  );

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds package by name", () => {
    const found = resolvePackageDir(packagesDir, "@zenspc/pi-safety", {
      readdirSync,
      readFileSync,
      existsSync,
      join,
    });
    assert.equal(found.folderName, "pi-safety");
    assert.equal(found.packageJson.version, "0.1.0");
  });

  it("throws when missing", () => {
    assert.throws(
      () =>
        resolvePackageDir(packagesDir, "@zenspc/nope", {
          readdirSync,
          readFileSync,
          existsSync,
          join,
        }),
      /no workspace package/,
    );
  });
});
