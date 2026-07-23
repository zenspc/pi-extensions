# @zenspc/pi-devtools

Context usage report, working-directory switching, and richer session footer for Pi.

## Install

```bash
pi install npm:@zenspc/pi-devtools
```

Local development:

```bash
pi -e ./packages/pi-devtools
pi install ./packages/pi-devtools
```

## What you get

### `/cd` and `/pwd`

Change Pi's project working directory without quitting the process.

Pi binds tools, project context (`AGENTS.md`), project settings/extensions (after trust), and the footer cwd to the **session** cwd.
`/cd` prepares a session for the target directory and switches to it so the host rebuilds that runtime state (same idea as quit → `cd` → open Pi again).

```text
/pwd
/cd
/cd <path>
/cd <path> --new
/cd <path> --fork
```

Behavior:

- **Default** - resume the most recent session for `<path>` if one exists; otherwise create a new session there.
- **`--new`** - always create a fresh session in `<path>` (still records the previous session as `parentSession` when available).
- **`--fork`** - copy the current session history into a new session under `<path>` (requires a persisted current session file).
- **`/cd` with no path** - print the current cwd and usage.
- **`/pwd`** - print cwd and the active session file path.

Notes:

- Paths may be absolute, relative to the current cwd, or start with `~`.
- The target must already exist and be a directory.
- Switching into a project with local `.pi` / `.agents` resources may prompt for project trust (same as resume).
- This is one active cwd at a time, not a multi-root workspace.
- There is no LLM tool for `/cd` (command only).

### `/context`

Detailed context usage report.

Shows startup context (system prompt, tools, context files, skills) and, once a conversation exists, LLM-facing entries with content-block breakdown.

Subcommands:

- `help`
- `prompt` - system prompt size (chars / tokens / lines)
- `prompt full` - dump full system prompt text
- `memory [substr]`
- `tools`
- `json`

In the TUI, `/context prompt` starts collapsed.
Press `e` or `space` to expand or collapse the body.

Context overlays scroll inside the component (not via terminal scrollback), so they keep working when other extensions (for example sticky editor) own transcript scrolling:

- `↑` / `↓`, `j` / `k`, `Ctrl+N` / `Ctrl+P` - line scroll
- `PgUp` / `PgDn` - page scroll
- `g` / `Home`, `G` / `End` - jump top/bottom
- `Esc` / `Enter` - close

Overlay content is never added to the model context.

Security note:

- Default `/context` and `/context prompt` are size/metadata oriented (no full bodies).
- `prompt full`, expanded TUI prompt view, and `memory <substr>` dump **raw** local content (system prompt and memory file bodies).
- Those dumps can contain secrets, tokens, paths, or PII.
- Overlay output is never added to the model context.
- Prefer `/context json` when sharing a report.
- Redact dumps before pasting into chats, tickets, or GitHub issues.
- Large dumps are truncated for display (print mode and UI).

`/context help` repeats the same warnings.

### Custom footer

Richer footer status for the active session, including response timing and cache-freshness heuristics.

`PI_CACHE_RETENTION=long` switches the cache TTL heuristic to the longer retention window.

## Install only one extension

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": ["extensions/cd-command.ts"]
    }
  ]
}
```

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": ["extensions/context-command.ts"]
    }
  ]
}
```

Or:

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": ["extensions/custom-footer.ts"]
    }
  ]
}
```

## Source

```text
extensions/cd-command.ts
extensions/cd-helpers.mjs
extensions/context-command.ts
extensions/context-scroll.mjs
extensions/custom-footer.ts
```
