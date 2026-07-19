# @zenspc/pi-spinner

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
