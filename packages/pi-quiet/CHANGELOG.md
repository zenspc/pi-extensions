# @zenspc/pi-quiet

## 0.1.0

### Minor Changes

- Add `@zenspc/pi-quiet` for Quiet Display on Pi built-in tools.

  - Default-on dense Quiet Rows for `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`
  - Per-tool Success Chips (counts, diff stats, exit code); no multi-line success bodies
  - Soft vs Hard Breakthrough; hard failures auto-show a capped error tail
  - `/quiet` toggle / on / off / status with Sticky Preference in `~/.pi/agent/extensions/quiet.json`
  - Expand uses full Stock Display body; expand does not flip the preference
  - Toggle is forward-only (scrollback unchanged)
