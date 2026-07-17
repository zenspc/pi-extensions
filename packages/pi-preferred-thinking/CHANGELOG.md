# @zenspc/pi-preferred-thinking

## 0.2.0

### Minor Changes

- d2033c8: Add `@zenspc/pi-preferred-thinking` for model-specific thinking level preferences.

  Config lives at `$PI_CODING_AGENT_DIR/extensions/preferred-thinking.json` (default `~/.pi/agent/extensions/preferred-thinking.json`).
  Preferences apply on model switch and new-session start; invalid or missing values are ignored.
  Includes `/preferred-thinking` for show/list/set/clear/reload.
