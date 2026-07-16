# Changesets

When you change a publishable package under `packages/`, add a changeset:

```bash
pnpm changeset
```

Pick the packages that changed, the bump type (patch / minor / major), and a short summary.

A **Version packages** PR is opened automatically on `master` when pending changesets exist.
Merging that PR bumps versions and writes changelogs.
Tags and npm publish are handled separately (see [docs/publishing.md](../docs/publishing.md)).
