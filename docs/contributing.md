# Contributing

## Layout

Each publishable unit lives under `packages/<name>` and is an independent npm package under the `@zenspc` scope.

```text
packages/
  pi-safety/
  pi-workflow/
  pi-devtools/
  pi-preferred-thinking/
  pi-copilot-discovery/
  pi-spinner/
  pi-quiet/
  pi-sticky-editor/
```

## Local development

From the monorepo root:

```bash
pnpm check

# load one package for the current run only
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools
pi -e ./packages/pi-preferred-thinking
pi -e ./packages/pi-copilot-discovery
pi -e ./packages/pi-spinner
pi -e ./packages/pi-quiet
pi -e ./packages/pi-sticky-editor

# install from path into user settings
pi install ./packages/pi-safety
```

Path installs are not copied.
Edit files in place and restart or `/reload` as needed.

## Adding an extension

1. Decide which package it belongs in (same audience, risk, and release cadence).
2. Add the TypeScript module under that package's `extensions/` directory.
3. Update the package README.
4. Run `pnpm check` and `pnpm test`.
5. Smoke test with `pi -e ./packages/<name>`.
6. If the change should ship to npm, run `pnpm changeset` and commit the generated file under `.changeset/`.

If the extension has a different audience, risk profile, or heavy dependencies, create a new package instead of forcing it into an existing one.

## Package rules

- `package.json` must include `keywords: ["pi-package"]`.
- Declare resources under the `pi` key.
- List Pi runtime packages as `peerDependencies` with `"*"`.
- Keep npm tarballs small with `"files"` limited to runtime paths (`extensions` or `src/`), `README.md`, and `LICENSE`.
- Releases are driven by changesets + tags; see [publishing.md](./publishing.md).
