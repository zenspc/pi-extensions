#!/usr/bin/env node
/**
 * Create missing annotated git tags for workspace packages:
 *   @zenspc/<name>@<version>
 *
 * Usage:
 *   node scripts/tag-packages.mjs           # print tags that would be created
 *   node scripts/tag-packages.mjs --apply   # create local tags
 *   node scripts/tag-packages.mjs --apply --push  # create and push
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");
const apply = process.argv.includes("--apply");
const push = process.argv.includes("--push");

function existingTags() {
  try {
    const out = execFileSync("git", ["tag", "--list", "@zenspc/*"], {
      cwd: root,
      encoding: "utf8",
    });
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function listPackages() {
  const tags = [];
  for (const name of readdirSync(packagesDir)) {
    const dir = join(packagesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.private) continue;
    if (!pkg.name?.startsWith("@zenspc/") || !pkg.version) continue;
    tags.push({ name: pkg.name, version: pkg.version, tag: `${pkg.name}@${pkg.version}` });
  }
  return tags;
}

const have = existingTags();
const planned = listPackages().filter((p) => !have.has(p.tag));

if (planned.length === 0) {
  console.log("tag-packages: no missing tags");
  process.exit(0);
}

for (const p of planned) {
  console.log(p.tag);
  if (!apply) continue;
  execFileSync(
    "git",
    ["tag", "-a", p.tag, "-m", `Release ${p.name} ${p.version}`],
    { cwd: root, stdio: "inherit" },
  );
  if (push) {
    execFileSync("git", ["push", "origin", p.tag], { cwd: root, stdio: "inherit" });
  }
}

if (!apply) {
  console.log("tag-packages: dry-run only (pass --apply to create, --push to push)");
}
