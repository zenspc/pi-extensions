# @zenspc/pi-spinner

Replaces pi's default "Working..." loader text and braille spinner with a user-chosen animation preset and a rotating message list.

## Install

```bash
pi install npm:@zenspc/pi-spinner
```

Local development from this monorepo:

```bash
pi -e ./packages/pi-spinner
pi install ./packages/pi-spinner
```

## Quick start

1. Run `/spinner` inside pi to open the customization TUI.
2. Pick an animation preset, edit your message list, set the cycle interval, and save (to global or project).
3. Next time pi streams a response, the loader uses your new animation and rotates through your messages.

If you never customize anything, the extension uses pi's built-in defaults: braille spinner, "Working..." text, no rotation. You can opt out by running `/spinner-reset` and the loader returns to pi's default.

## Commands

| Command | Description |
|---|---|
| `/spinner` | Open the interactive customization TUI |
| `/spinner-reset` | Restore pi's default spinner and stop message rotation |
| `/spinner-rotate` | Force-advance to the next message (useful for previewing changes) |

## Built-in animation presets

| Name | Description |
|---|---|
| `braille` | Pi's default 10-frame braille spinner |
| `dots` | Dim-to-accent pulse: `· • ● •` |
| `arrows` | Eight arrows spinning around the compass |
| `bars` | 12 bars growing and shrinking like a VU meter |
| `progress` | Five-frame progress bar that fills and resets |
| `rainbow` | Dots cycling through the full theme color palette |
| `minimal` | Static muted ellipsis, no animation |

## Config files

The extension loads (and merges) two optional JSON config files:

| Path | Scope |
|---|---|
| `~/.pi/agent/extensions/spinner.json` | Global, applies to all projects |
| `<project>/.pi/spinner.json` | Project-local, overrides global |

Merge order: built-in defaults < global < project. So a project file with just `{ "preset": "rainbow" }` keeps your global messages and overrides only the preset.

### Schema

```jsonc
{
	// Animation preset name. One of: braille, dots, arrows, bars, progress, rainbow, minimal.
	// Ignored if `customFrames` is non-empty.
	"preset": "dots",

	// Message list, one entry per line in the TUI editor. One is shown at a time
	// while the agent is working; the cycler rotates through them on a timer.
	"messages": [
		"Thinking...",
		"Pondering...",
		"Brewing ideas...",
	],

	// How often (ms) to switch to the next message. Clamped to [1500, 15000].
	"cycleIntervalMs": 5000,

	// Optional raw animation frames. When non-empty, this overrides `preset`.
	// Each frame is up to 4 characters; max 32 frames.
	"customFrames": ["⠋", "⠙", "⠹", "⠸"],
	// Frame interval (ms) for `customFrames`. Clamped to [50, 2000]. Default 100.
	"customIntervalMs": 80
}
```

### Example: minimal global override

```json
{
	"preset": "rainbow",
	"cycleIntervalMs": 3000
}
```

### Example: project-local custom messages

`.pi/spinner.json` in your repo:

```json
{
	"messages": [
		"Compiling...",
		"Running tests...",
		"Formatting diff...",
	]
}
```

## How it works

- On `session_start`, the extension reads and merges the config files, calls `ctx.ui.setWorkingIndicator(...)` with themed frames, and starts a `MessageCycler` that calls `ctx.ui.setWorkingMessage(...)` on a timer.
- Both APIs already persist across loader recreations inside a session, so the animation and current message survive between agent turns without extra work.
- On `session_shutdown` (e.g. `/new`, `/resume`, `/fork`, `/reload`, or exit), the cycler is stopped and pi's default "Working..." text is restored.
- In non-TUI modes (`rpc`, `json`, `print`), the underlying APIs are no-ops, and the extension short-circuits its session_start work, so it never spins a timer in those modes.

## Limitations

- The custom loader is only visible in interactive TUI mode, consistent with pi's own loading UI. RPC/print/JSON runs ignore it.
- Custom animation frames are rendered verbatim; the extension wraps them in `theme.fg("accent", ...)` for the built-in presets, so theme changes (light/dark) are honored automatically. If you supply `customFrames`, they also use the accent color.
- The editor that opens for message editing uses pi's standard input editor, so familiar shortcuts work.

## Source

```text
src/index.ts
src/presets.ts
src/config.ts
src/cycler.ts
src/ui.ts
```
