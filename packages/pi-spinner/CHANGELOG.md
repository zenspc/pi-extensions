# @zenspc/pi-spinner

## 0.4.0

### Minor Changes

- 8bb14b2: Preview the highlighted animation in `/spinner` before pressing enter.

## 0.3.0

### Minor Changes

- 137108c: Add line, arc, star, box, hamburger, and point animation presets.

## 0.2.0

### Minor Changes

- 2bdb0b4: Optionally show the current tool as the working message while it runs.
- 2bdb0b4: Expose custom animation frames and interval in the /spinner TUI, and raise the per-frame cap to 8 so the shipped progress frames are legal as custom frames.
- 2bdb0b4: Add sequential message cycling and built-in calm/dry message packs.
- 2bdb0b4: Add hidden and static-dot working-indicator presets.
- 2bdb0b4: Add /spinner args for preset, status, packs, cycle mode, and scoped reset.
- 2bdb0b4: Optionally copy the rotating working message onto the hidden-thinking label.

## 0.1.1

### Patch Changes

- 5e12801: Harden spinner config IO against untrusted project files: size caps, symlink refusal, atomic 0o600 writes, ANSI/control stripping, allowlisted keys/presets, and message/frame bounds.

## 0.1.0

### Minor Changes

- Add `@zenspc/pi-spinner` for customizable streaming spinner animation and message rotation.

  - 7 built-in animation presets: `braille`, `dots`, `arrows`, `bars`, `progress`, `rainbow`, `minimal`
  - Rotating message list with a configurable cycle interval (1.5-15s)
  - Interactive `/spinner` TUI for picking preset, editing messages, and saving to global or project config
  - `/spinner-reset` to restore pi's defaults; `/spinner-rotate` to force-advance
  - Config is merged from `~/.pi/agent/extensions/spinner.json` and `<cwd>/.pi/spinner.json`
  - TUI-only; the cycler is a no-op in `rpc`, `json`, and `print` modes
