# @zenspc/pi-devtools

## 0.2.1

### Patch Changes

- 68612cc: Fix custom footer thinking level stuck on `high` for new sessions by reading the live session level via `pi.getThinkingLevel()`, and map `xhigh`/`max` color tokens correctly.

## 0.2.0

### Minor Changes

- fb7b40c: Add `/cd` and `/pwd` to switch working directory by resuming or creating a session for the target project (`--new`, `--fork`).
