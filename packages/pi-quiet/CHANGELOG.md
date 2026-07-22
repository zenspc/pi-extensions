# @zenspc/pi-quiet

## 0.3.0

### Minor Changes

- c957e2b: Foreign Tools + Generic Kind Formatter; prefer Pi `registerToolRenderer` when available.

  Shared 🧩 Kind Emoji, priority arg peek (secret keys skipped), chips `ok` / `empty` / `failed`.
  Foreign Tools join Run Compaction by exact tool name when the upstream Tool Renderer Wrapper seam exists.
  Without the seam, built-in Quiet path is unchanged and Foreign Tools stay Stock.

## 0.2.2

### Patch Changes

- 39d48b0: Keep settled Compaction Groups across trailing pending same-kind tools and cut TUI invalidate thrash.

  Settled success/soft neighbors stay folded while a trailing same-kind tool runs; the group grows only after that tool settles. Live index updates are single-writer via `tool_execution_*` events. O(1) row lookup, paint-only invalidates, lighter line counting, and retain result bodies only for quiet success|soft rows.

## 0.2.1

### Patch Changes

- 0ee3b0d: Restore Tool Shell Background on visible Quiet surfaces under `renderShell: "self"`.

  Stock-matching pending/success/error strips on Quiet Rows and Compaction Groups so built-ins match other tools. Hidden compaction members stay zero-height. Quiet-off wraps non-edit built-ins; edit keeps its own shell.

## 0.2.0

### Minor Changes

- 31d6e88: Run Compaction and Quiet chrome polish for `@zenspc/pi-quiet`.

  Adjacent same-kind success/soft tool rows fold into Group Header + Member Bullets (last-member carrier). Kind Emoji on Quiet Rows and headers. Groups rebuild from session history; whole-group expand to Stock bodies.

## 0.1.0

### Minor Changes

- 290a6a1: Add `@zenspc/pi-quiet` for Quiet Display on Pi built-in tools.

  Dense default-on Quiet Rows for read/bash/edit/write/find/grep/ls, Soft/Hard Breakthrough, and `/quiet` Sticky Preference.

## 0.1.0

### Minor Changes

- Add `@zenspc/pi-quiet` for Quiet Display on Pi built-in tools.

  - Default-on dense Quiet Rows for `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`
  - Per-tool Success Chips (counts, diff stats, exit code); no multi-line success bodies
  - Soft vs Hard Breakthrough; hard failures auto-show a capped error tail
  - `/quiet` toggle / on / off / status with Sticky Preference in `~/.pi/agent/extensions/quiet.json`
  - Expand uses full Stock Display body; expand does not flip the preference
  - Toggle is forward-only (scrollback unchanged)
