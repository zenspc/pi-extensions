# Publishing

## Prerequisites

- npm account with access to the `@zenspc` scope
- logged in via `npm login`
- package versions bumped intentionally

## One package

```bash
cd packages/pi-safety
npm publish --access public
```

Or with pnpm from the monorepo root:

```bash
pnpm --filter @zenspc/pi-safety publish --access public
```

## All packages

```bash
pnpm -r publish --access public
```

## Pre-publish checklist

1. `pnpm check`
2. Smoke test each package:

```bash
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools
```

3. Confirm README install commands use the correct package names.
4. Bump `version` in the package you are releasing.
5. Publish.
6. Verify install from npm:

```bash
pi install npm:@zenspc/pi-safety
```

## Versioning

Use independent versions per package.
Bump only the packages that changed.
Start at `0.1.0` until the public API feels stable.
