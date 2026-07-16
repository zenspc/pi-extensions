# Publishing

## Release model (locked)

This monorepo uses **independent package versions**, **changeset-driven Version PRs**, and **per-package git tags** as the only supported release train.

Canonical path from monorepo changes to public npm packages and GitHub Releases under `@zenspc`:

1. Land changes on `master` with a **changeset** (`.changeset/*.md`)
2. **Version packages** PR bumps only changed packages and writes changelogs
3. After that merge, CI creates missing tags `@zenspc/<pkg>@<version>` and dispatches publish
4. **Publish package** workflow runs `npm publish` + creates a matching GitHub Release

Rules that do not change without a new plan:

- Root package stays `"private": true` and is never published
- Never republish an existing version; always bump first
- Do not store npm tokens in the git repo
- CI publish uses the `NPM_TOKEN` repository secret (granular automation token preferred)
- Local `npm login` publish is emergency-only; CI is primary
- Tag format is always `@zenspc/<name>@<semver>` (not monorepo-only `v*` tags)

## Prerequisites

- npm user/org that owns `@zenspc` with 2FA enabled
- Repo secret `NPM_TOKEN`: npm **granular automation** token (type **Automation**, not classic / publish-with-OTP) with publish rights on `@zenspc/*`
  - Classic tokens and granular tokens that still require 2FA OTP will fail CI with `EOTP`
- Actions allowed to create PRs, tags, and GitHub Releases on the default branch

```bash
npm whoami
# Optional availability checks (404 means not published yet):
npm view @zenspc/pi-safety version || true
```

## Contributor flow (version automation)

When you change a publishable package:

```bash
pnpm changeset
```

Select the packages, bump type, and a short summary. Commit the file under `.changeset/`.

On push to `master`, `.github/workflows/release-pr.yml` opens or updates a **Version packages** PR (`changesets/action`).
Merging that PR runs `pnpm run version-packages` results (already applied on the PR branch) onto `master`.

After the version merge, the same workflow creates any missing annotated tags and **dispatches** `publish.yml` for each new tag (tag pushes made with `GITHUB_TOKEN` do not start other workflows on their own):

```text
@zenspc/pi-safety@0.1.0
@zenspc/pi-workflow@0.1.0
@zenspc/pi-devtools@0.1.0
@zenspc/pi-copilot-discovery@0.3.2
```

Manual tag dry-run:

```bash
pnpm tag-packages
pnpm tag-packages -- --apply
pnpm tag-packages -- --apply --push
```

## Versioning policy

Packages use **independent** versions.

| Change | Bump |
|---|---|
| Docs, help text, safe bugfixes | patch |
| New commands/features, non-breaking | minor |
| Breaking behavior or config changes | major |

- Bump only packages that changed (via changesets).
- Never republish an existing version.
- Root `package.json` stays `"private": true`.

## Tag-triggered publish (CI)

`.github/workflows/publish.yml` runs on:

- `push` of tags matching `@zenspc/*@*`
- `workflow_dispatch` with `tag` + optional `dry_run` (default true)

For each tag it:

1. Parses `@zenspc/<name>@<semver>` (`scripts/parse-release-tag.mjs`)
2. Checks out the tagged commit
3. Runs `pnpm check` and `npm pack --dry-run` in that package
4. Fails if tag version ≠ `package.json` version
5. Skips `npm publish` if that version already exists on the registry
6. Publishes with `NODE_AUTH_TOKEN` / `NPM_TOKEN` when needed
7. Creates a GitHub Release for the tag (idempotent if it already exists)

Dry-run from Actions UI:

- Workflow: **Publish package**
- Input tag: `@zenspc/pi-safety@0.1.0`
- `dry_run`: true

## Tarball sanity

```bash
cd packages/<name>
npm pack --dry-run
```

Must include only intended paths: `extensions/` or `src/`, `README.md`, `package.json`, `LICENSE`.

Each package keeps `LICENSE` as a symlink to the repo-root license; `prepack` materializes a real file into the tarball, and `postpack` restores the symlink.

No `.pi/`, `local-test/`, `plan/`, auth files, home paths, or `AGENTS.md` unless deliberate.

## Manual / emergency publish

Prefer CI. If you must publish locally:

```bash
npm login
pnpm check
pnpm --filter @zenspc/pi-safety publish --access public
git tag -a @zenspc/pi-safety@0.1.0 -m "Release @zenspc/pi-safety 0.1.0"
git push origin @zenspc/pi-safety@0.1.0
```

Caution: `pnpm -r publish` attempts every non-private package. Prefer per-package or tag-driven CI.

## First-time bootstrap

1. Confirm `@zenspc` ownership and create a granular automation token → repo secret `NPM_TOKEN`.
2. Merge Changesets + publish workflows to `master`.
3. For already-correct unpublished versions, create tags without a bump:

```bash
node scripts/tag-packages.mjs --apply --push
```

Suggested first-publish order: `pi-safety`, `pi-devtools`, `pi-workflow`, then `pi-copilot-discovery`.

4. Confirm each tag's **Publish package** run, npm page, and:

```bash
pi install npm:@zenspc/pi-safety
```

5. Later releases use changesets + Version PR only.

## Pre-publish checklist (still useful for manual cuts)

1. `git status` clean on the release commit
2. `pnpm check` and `pnpm test`
3. Smoke-load packages you care about with `pi -e ./packages/<name>`
4. README install commands use `npm:@zenspc/...`
5. Changeset (or intentional version) is correct
6. `npm pack --dry-run` clean

## Bad release / incident basics

1. Publish a fixed version (new bump + tag).
2. Deprecate the bad version:

```bash
npm deprecate @zenspc/<pkg>@<ver> "reason; use @zenspc/<pkg>@X.Y.Z"
```

3. If tokens leaked via a tarball, rotate them and treat as a security incident (see [SECURITY.md](../SECURITY.md)).

## CI layout

| Workflow | Trigger | Role |
|---|---|---|
| `ci.yml` | PR + push to default branch | `pnpm check` + `pnpm test`; no npm token |
| `release-pr.yml` | push to default branch | Version PR + missing package tags + dispatch publish |
| `publish.yml` | package tags / dispatch | npm publish + GitHub Release |

## Install path truth in docs

After a package is on npm:

- Root and package READMEs use `npm:@zenspc/...` as the primary install path.
- Keep path/git install examples under local development sections.

## Out of scope (this automation)

- npm OIDC trusted publishing (token secret is the current path)
- Fully automated Changesets multi-package publish without tags
- Marketing / social announcement copy
- Branch-protection policy changes that require org admin UI (document recommended settings only)

## Acceptance criteria

- Version PR automation can bump packages via changesets
- Tag `@zenspc/<pkg>@<ver>` (or workflow_dispatch) publishes that package when the version is new
- Matching GitHub Release exists per published tag
- Already-published versions skip npm publish without failing the release step
- No npm token in git; `ci.yml` does not receive `NPM_TOKEN`
- `docs/publishing.md` matches the automated path
- `pnpm check` and `pnpm test` pass on the default branch
