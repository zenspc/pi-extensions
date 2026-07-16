# Contributing

## Layout

Each publishable unit lives under `packages/<name>` and is an independent npm package under the `@zenspc` scope.

```text
packages/
  pi-safety/
  pi-workflow/
  pi-devtools/
```

## Local development

From the monorepo root:

```bash
pnpm check

# load one package for the current run only
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools

# install from path into user settings
pi install ./packages/pi-safety
```

Path installs are not copied.
Edit files in place and restart or `/reload` as needed.

## Adding an extension

1. Decide which package it belongs in (same audience, risk, and release cadence).
2. Add the TypeScript module under that package's `extensions/` directory.
3. Update the package README.
4. Run `pnpm check`.
5. Smoke test with `pi -e ./packages/<name>`.

If the extension has a different audience, risk profile, or heavy dependencies, create a new package instead of forcing it into an existing one.

## Package rules

- `package.json` must include `keywords: ["pi-package"]`.
- Declare resources under the `pi` key.
- List Pi runtime packages as `peerDependencies` with `"*"`.
- Keep npm tarballs small with `"files": ["extensions", "README.md"]`.
