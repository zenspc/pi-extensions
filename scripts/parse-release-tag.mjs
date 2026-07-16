/**
 * Parse per-package release tags: @zenspc/<name>@<semver>
 */
import { pathToFileURL } from "node:url";

const TAG_RE = /^(@zenspc\/[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?)$/;

/**
 * @param {string} tag
 * @returns {{ packageName: string, version: string }}
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error("release tag must be a non-empty string");
  }
  const normalized = tag.startsWith("refs/tags/") ? tag.slice("refs/tags/".length) : tag;
  const match = TAG_RE.exec(normalized);
  if (!match) {
    throw new Error(
      `invalid release tag "${normalized}"; expected @zenspc/<pkg>@<semver> (e.g. @zenspc/pi-safety@0.1.0)`,
    );
  }
  return { packageName: match[1], version: match[2] };
}

/**
 * Map package name to directory under packages/ by reading package.json files.
 * @param {string} packagesDir
 * @param {string} packageName
 * @param {{ readdirSync: Function, readFileSync: Function, existsSync: Function, join: Function }} fsPath
 */
export function resolvePackageDir(packagesDir, packageName, fsPath) {
  const { readdirSync, readFileSync, existsSync, join } = fsPath;
  if (!existsSync(packagesDir)) {
    throw new Error(`packages directory missing: ${packagesDir}`);
  }
  for (const name of readdirSync(packagesDir)) {
    const dir = join(packagesDir, name);
    const pkgJsonPath = join(dir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (pkg.name === packageName) {
      return { dir, packageJson: pkg, folderName: name };
    }
  }
  throw new Error(`no workspace package named ${packageName}`);
}

function main(argv) {
  const tag = argv[2];
  if (!tag) {
    console.error("usage: node scripts/parse-release-tag.mjs <tag>");
    process.exit(2);
  }
  const parsed = parseReleaseTag(tag);
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main(process.argv);
}
