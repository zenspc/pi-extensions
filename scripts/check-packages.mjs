#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");

function fail(message) {
  console.error(`check-packages: ${message}`);
  process.exitCode = 1;
}

function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

if (!existsSync(packagesDir)) {
  fail(`missing packages directory: ${packagesDir}`);
  process.exit(1);
}

const packageNames = readdirSync(packagesDir).filter((name) =>
  statSync(join(packagesDir, name)).isDirectory(),
);

if (packageNames.length === 0) {
  fail("no packages found under packages/");
  process.exit(1);
}

for (const name of packageNames) {
  const pkgDir = join(packagesDir, name);
  const pkgJsonPath = join(pkgDir, "package.json");
  const readmePath = join(pkgDir, "README.md");

  if (!existsSync(pkgJsonPath)) {
    fail(`${name}: missing package.json`);
    continue;
  }

  if (!existsSync(readmePath)) {
    fail(`${name}: missing README.md`);
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch (error) {
    fail(`${name}: invalid package.json (${error.message})`);
    continue;
  }

  if (!pkg.name?.startsWith("@zenspc/")) {
    fail(`${name}: package name must use @zenspc scope (got ${pkg.name})`);
  }

  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("pi-package")) {
    fail(`${name}: keywords must include "pi-package"`);
  }

  if (!pkg.pi || typeof pkg.pi !== "object") {
    fail(`${name}: missing package.json "pi" manifest`);
    continue;
  }

  const resourceKeys = ["extensions", "skills", "prompts", "themes"];
  let declared = 0;
  for (const key of resourceKeys) {
    const entries = pkg.pi[key];
    if (!entries) continue;
    if (!Array.isArray(entries)) {
      fail(`${name}: pi.${key} must be an array`);
      continue;
    }
    declared += entries.length;
    for (const entry of entries) {
      const target = join(pkgDir, entry);
      if (!existsSync(target)) {
        fail(`${name}: pi.${key} path not found: ${entry}`);
      }
    }
  }

  if (declared === 0) {
    fail(`${name}: pi manifest declares no resources`);
  }

  const extensionsDir = join(pkgDir, "extensions");
  if (existsSync(extensionsDir)) {
    const files = listTsFiles(extensionsDir);
    if (files.length === 0) {
      fail(`${name}: extensions/ exists but contains no .ts/.js files`);
    } else {
      console.log(
        `${pkg.name}: ${files.length} extension file(s) (${files
          .map((f) => relative(pkgDir, f))
          .join(", ")})`,
      );
    }
  }
}

if (process.exitCode) {
  console.error("check-packages: failed");
  process.exit(process.exitCode);
}

console.log(`check-packages: ok (${packageNames.length} package(s))`);
