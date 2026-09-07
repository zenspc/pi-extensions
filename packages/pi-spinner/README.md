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
2. Open Animation and arrow through the list.
   Built-ins come first, then your named customs, then **New custom…**.
   The highlighted spinner plays at the top of the picker before you press enter.
   Enter applies it. Escape keeps the previous animation.
   **New custom…** asks for a name, then frames (one per line), then an interval (default 100ms).
   That upserts the registry and selects the new name.
   When the active animation is a custom, the main menu shows **Edit custom** (frames, interval, delete with confirm).
   Delete falls back to `braille`.
   Then edit your message list, set the cycle interval, and save (to global or project).
   Cycle order can be random or sequential.
   A built-in message pack (default, calm, dry) replaces the current list when you pick it in the TUI.
   Activity messages are off by default; turn them on from the TUI to briefly show the current tool.
3. Next time pi streams a response, the loader uses your new animation and rotates through your messages.

If you never customize anything, the extension uses pi's built-in defaults: braille spinner, "Working..." text, no rotation. You can opt out by running `/spinner-reset` and the loader returns to pi's default.

## Commands

| Command | Description |
|---|---|
| `/spinner` | Open the TUI |
| `/spinner status` | Show merged config + paths |
| `/spinner help` | Usage |
| `/spinner <preset>` | Set animation (built-in name or custom name) |
| `/spinner pack <name>` | Replace messages with a built-in pack |
| `/spinner random` / `/spinner sequential` | Set cycle order |
| `/spinner rotate` | Same as `/spinner-rotate` |
| `/spinner reset` | Same as `/spinner-reset` (both files) |
| `/spinner-reset [global\|project]` | Scoped or full reset |

Slash mutations save to the **global** file unless the verb is a scoped reset.
Project overrides still win on next load if present.

## Built-in animation presets

| Name | Description |
|---|---|
| `braille` | Pi's default 10-frame braille spinner |
| `dots` | Dim-to-accent pulse: `· • ● •` |
| `arrows` | Eight arrows spinning around the compass |
| `bars` | 12 bars growing and shrinking like a VU meter |
| `progress` | Five-frame progress bar that fills and resets |
| `rainbow` | Dots cycling through the full theme color palette |
| `line` | Classic ASCII \| / - \\ spinner |
| `arc` | Six-frame circular arc |
| `star` | Sparkle that grows and shrinks |
| `box` | Four quadrants bouncing around a cell |
| `hamburger` | Three-frame trigram morph |
| `point` | A dot running through an ellipsis |
| `minimal` | Static muted ellipsis, no animation |
| `dot` | Single static accent dot |
| `hidden` | No glyph; the working message still shows. Compaction and retry loaders stay on pi's built-in styling. |

## Config files

The extension loads (and merges) two optional JSON config files:

| Path | Scope |
|---|---|
| `~/.pi/agent/extensions/spinner.json` | Global, applies to all projects |
| `<project>/.pi/spinner.json` | Project-local, overrides global |

Merge order: built-in defaults < global < project. So a project file with just `{ "preset": "rainbow" }` keeps your global messages and customs and overrides only the active animation.
A project file that sets `customs` replaces the previous layer's registry, including `customs: []`.

### Schema

```jsonc
{
	// Active animation name. A built-in (braille, dots, arrows, bars, progress,
	// rainbow, line, arc, star, box, hamburger, point, minimal, dot, hidden)
	// or a name from `customs`.
	"preset": "wave",

	// Named custom animations. Max 20. Names are lowercase `[a-z][a-z0-9-]{0,31}`
	// and cannot collide with built-ins or slash verbs (help, status, rotate,
	// reset, pack, random, sequential). Each entry: 1-32 frames, each frame up
	// to 8 characters. intervalMs is clamped to [50, 2000]; default 100.
	"customs": [
		{ "name": "wave", "frames": ["~", "≈", "~"], "intervalMs": 80 },
		{ "name": "blocks", "frames": ["▖", "▘", "▝", "▗"], "intervalMs": 90 }
	],

	// Message list, one entry per line in the TUI editor. One is shown at a time
	// while the agent is working; the cycler rotates through them on a timer.
	// Max 50 messages; each message is capped at 120 characters after sanitization.
	"messages": [
		"Thinking...",
		"Pondering...",
		"Brewing ideas...",
	],

	// Last picked built-in pack name. One of: default, calm, dry.
	// Picking a pack in the TUI replaces `messages` with that pack.
	// A JSON file that sets only `messagePack` does not rewrite `messages` on load.
	// The `messages` key still wins; otherwise the default list remains.
	"messagePack": "default",

	// How often (ms) to switch to the next message. Clamped to [1500, 15000].
	"cycleIntervalMs": 5000,

	// Order used when picking the next message.
	// `random` (default) shuffles and avoids an immediate repeat.
	// `sequential` walks the list and wraps.
	"cycleMode": "random",

	// When true, the working message briefly shows the current tool
	// (basename / first token only) while it runs. The cycler resumes
	// after the tool ends. Default false. TUI only.
	"activityMessages": false,

	// When true, the current rotating message is also used as pi's
	// Ctrl+T hidden-thinking label (raw, un-themed). Off restores pi's
	// default on session shutdown. Default false.
	"syncThinkingLabel": false
}
```

Old files that set non-empty `customFrames` (and omit `customs`) load as one custom named `custom`.
The next save writes `customs` and omits `customFrames` / `customIntervalMs`.
If the old file also set a built-in `preset`, the active identity becomes `custom` because those frames used to win.

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
- If `activityMessages` is on, `tool_execution_start` overrides the working message with a sanitized one-liner for the current tool (basename or first command token only).
  The cycler resumes after `tool_execution_end`, and leftover overrides are cleared on `agent_end` / `agent_settled`.
  Off by default; TUI only; activity text is never written back to `spinner.json`.
- If `syncThinkingLabel` is on, the current rotating message is also used as pi's Ctrl+T hidden-thinking label (raw, un-themed). Pi's default label is restored on `session_shutdown` (or `/spinner-reset`).
- Both APIs already persist across loader recreations inside a session, so the animation and current message survive between agent turns without extra work.
- On `session_shutdown` (e.g. `/new`, `/resume`, `/fork`, `/reload`, or exit), the cycler is stopped and pi's default "Working..." text is restored.
- In non-TUI modes (`rpc`, `json`, `print`), the underlying APIs are no-ops, and the extension short-circuits its session_start work, so it never spins a timer in those modes.

## Limitations

- The custom loader is only visible in interactive TUI mode, consistent with pi's own loading UI. RPC/print/JSON runs ignore it.
- Custom animation frames are rendered verbatim.
  Built-in presets wrap each frame in `theme.fg(...)` using that preset's color keys, so theme changes (light/dark) are honored automatically.
  Named customs use the accent color.
- The editor that opens for message and custom-frame editing uses pi's standard input editor, so familiar shortcuts work.
- Named customs are created and edited from `/spinner`.
  Empty frames abort create or edit and do not delete the entry.

## Security notes

Config files are untrusted input (especially `<project>/.pi/spinner.json` from a cloned repo).

Hardening applied at the config boundary:

- File size capped at 100 KB; larger files are ignored.
- Only regular files are read or overwritten (symlinks/dirs/devices are refused).
- Writes are atomic (temp + rename) with mode `0o600`; parent dirs are created as `0o700`.
- Keys are allowlisted; unknown fields (including `customized` runtime state) are never persisted.
- `preset` must be a built-in name or a valid custom identifier; unknown junk is dropped.
  A dangling custom `preset` falls back to `braille` after merge.
- `cycleMode` must be `random` or `sequential`; unknown values are dropped.
- `messagePack` must be `default`, `calm`, or `dry`; unknown values are dropped.
- Messages and frames are stripped of ANSI/control characters before they reach the TUI.
- Tool args used for activity messages are sanitized the same way as config messages before they reach the TUI (ANSI/control stripped, then capped at 40 characters).
  Only a basename or the first command token is shown; full paths and command lines are not.
- Message count (50), message length (120), custom spinner count (20), frame count (32), and frame length (8) are hard-capped.
- Custom names must match `^[a-z][a-z0-9-]{0,31}$` and cannot equal a built-in or slash verb.
- Intervals are clamped to documented ranges.

This package does not touch the network, credentials, or the model context.
It only changes the local loader animation and text in TUI mode.

## Source

```text
src/index.ts
src/command.ts
src/constants.ts
src/presets.ts
src/preview.ts
src/config.ts
src/activity.ts
src/cycler.ts
src/ui.ts
```
