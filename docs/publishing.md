# Publishing

Repeatable path from monorepo changes to public npm packages and GitHub tags under `@zenspc`.

Do not store npm tokens in the git repo.
Use `npm login` locally, or CI secrets only when publish automation is intentionally added later.

## Prerequisites (npm account and scope)

- npm user or org that owns the `@zenspc` scope
- 2FA enabled on the npm account (prefer auth-and-writes or stronger)
- Confirmed ability to publish **public** packages under `@zenspc`
- Granular automation tokens only when CI publish is needed (not required for first manual publishes)

```bash
npm login
npm whoami

# Optional availability checks (404 means not published yet):
npm view @zenspc/pi-safety version || true
npm view @zenspc/pi-workflow version || true
npm view @zenspc/pi-devtools version || true
npm view @zenspc/pi-copilot-discovery version || true
```

## Versioning policy

Packages use **independent** versions.

- Bump only packages that changed.
- Never republish an existing version; always bump first.
- Pre-1.0: breaking changes are allowed; still prefer clear notes for consumers.

Recommended bump rules:

| Change | Bump |
|---|---|
| Docs, help text, safe bugfixes | patch |
| New commands/features, non-breaking | minor |
| Breaking behavior or config changes | major |

Root `package.json` stays `"private": true` and is never published.

## Tarball sanity

For each package about to release:

```bash
cd packages/<name>
npm pack --dry-run
# or
npm pack && tar -tf zenspc-<name>-<version>.tgz && rm zenspc-<name>-<version>.tgz
```

Must verify:

- Only intended paths: `extensions/` or `src/`, `README.md`, `package.json`, `LICENSE`
- Each package keeps `LICENSE` as a symlink to the repo-root license; `prepack` materializes a real file into the tarball, and `postpack` restores the symlink
- No `.pi/`, `local-test/`, `plan/`, auth files, home paths, or `AGENTS.md` unless deliberate
- `publishConfig.access` is `public`
- `repository.directory` points at the correct package folder

## Pre-publish checklist

Run from the monorepo root on a clean release commit:

1. `git status` is clean on the commit you intend to tag.
2. `pnpm check`
3. Smoke-load each package you are releasing:

```bash
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools
pi -e ./packages/pi-copilot-discovery
```

4. For copilot: `pi --offline --list-models` (or online discovery) without stderr stack traces.
5. README install commands still match package names (`npm:@zenspc/...`).
6. Version fields bumped intentionally for packages that changed.
7. `npm pack --dry-run` clean for each package releasing.
8. Changelog or GitHub Release notes drafted (minimum: bullet list of user-facing changes).

## Publish procedure

### One package

```bash
pnpm --filter @zenspc/pi-safety publish --access public
# or
cd packages/pi-safety && npm publish --access public
```

### All packages that are ready

```bash
pnpm -r publish --access public
```

Caution: `pnpm -r publish` attempts every non-private workspace package.
Only use it when every package version is ready and not already on npm.
Prefer per-package publish when versions are staggered.

Suggested first-release order:

1. `@zenspc/pi-safety` and `@zenspc/pi-devtools` (smaller surface)
2. `@zenspc/pi-workflow`
3. `@zenspc/pi-copilot-discovery` last (highest complexity, credential-adjacent)

### After publish

```bash
pi install npm:@zenspc/pi-safety
pi install npm:@zenspc/pi-workflow
pi install npm:@zenspc/pi-devtools
pi install npm:@zenspc/pi-copilot-discovery
```

One-shot session load:

```bash
pi -e npm:@zenspc/pi-copilot-discovery
```

Verify:

- npm package page shows the correct README
- `pi install` resolves
- Extension loads without path-install assumptions

## Git tags and GitHub Releases

Use **per-package tags** (recommended for independent versions):

```text
@zenspc/pi-safety@0.1.0
@zenspc/pi-workflow@0.1.0
@zenspc/pi-devtools@0.1.0
@zenspc/pi-copilot-discovery@0.3.2
```

```bash
git tag @zenspc/pi-copilot-discovery@0.3.2
git push origin @zenspc/pi-copilot-discovery@0.3.2
gh release create "@zenspc/pi-copilot-discovery@0.3.2" \
  --title "@zenspc/pi-copilot-discovery 0.3.2" \
  --notes-file - <<'EOF'
### Changes
- ...
EOF
```

Do not rely only on monorepo calendar/meta tags for consumers tracking a single package.

## CI

`.github/workflows/ci.yml` runs `pnpm check` on pull requests and pushes to the default branch.

It uses read-only `contents` permissions and **does not** publish or hold npm tokens.
Full multi-package release automation (Changesets / semantic-release) is out of scope for this baseline.

## Bad release / incident basics

If a bad version ships:

1. Publish a fixed version immediately (unpublish is limited after the npm window / policy).
2. Deprecate the bad version:

```bash
npm deprecate @zenspc/<pkg>@<ver> "reason; use @zenspc/<pkg>@X.Y.Z"
```

3. If tokens or secrets leaked via a tarball, rotate them and treat it as a security incident (see [SECURITY.md](../SECURITY.md)).

## Install path truth in docs

After a package is on npm:

- Root and package READMEs use `npm:@zenspc/...` as the primary install path.
- Keep path/git install examples under local development sections.
- Do not leave "once published" language on packages that are already public.
