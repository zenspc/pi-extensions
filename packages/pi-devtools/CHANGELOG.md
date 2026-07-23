# @zenspc/pi-devtools

## 0.2.3

### Patch Changes

- 69cc084: Make `/context` overlays scroll in-component (↑↓/jk, PgUp/PgDn, g/G) so previews stay usable when other extensions own terminal scrolling.

## 0.2.2

### Patch Changes

- 623116b: Perf and packaging fixes for always-on footer and safety-guard.

  - Footer: O(1) incremental usage totals, stop idle timer at cache TTL, show context as used/limit tokens
  - Safety: cache git-repo probe per session, shorter system prompt, register only the factory entry (helpers/tests are not extensions)

## 0.2.1

### Patch Changes

- 68612cc: Fix custom footer thinking level stuck on `high` for new sessions by reading the live session level via `pi.getThinkingLevel()`, and map `xhigh`/`max` color tokens correctly.

## 0.2.0

### Minor Changes

- fb7b40c: Add `/cd` and `/pwd` to switch working directory by resuming or creating a session for the target project (`--new`, `--fork`).
