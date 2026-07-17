# @zenspc/pi-preferred-thinking

## 0.2.1

### Minor Changes

- 549cc1e: Improve preferred-thinking UX and packaging, and harden config I/O.

  - Register only the real extension entry so helpers/tests are not loaded as extensions
  - Add tab completion for subcommands and levels (`set high` keeps the `set` token)
  - Bare `/preferred-thinking` shows help
  - Atomic config save with mode `0o600`; load ignores symlinks and non-regular files
  - Migrate helpers/tests from `.mjs` to TypeScript

## 0.2.0

### Minor Changes

- d2033c8: Add `@zenspc/pi-preferred-thinking` for model-specific thinking level preferences.

  Config lives at `$PI_CODING_AGENT_DIR/extensions/preferred-thinking.json` (default `~/.pi/agent/extensions/preferred-thinking.json`).
  Preferences apply on model switch and new-session start; invalid or missing values are ignored.
  Includes `/preferred-thinking` for show/list/set/clear/reload.
