# @zenspc/pi-quiet

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
