# @zenspc/pi-devtools

Context audit, working-directory switching, markdown preview, richer session footer, custom welcome header, and Dracula theme for Pi.

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

### `/ctx`

Audits what fills the context window and attributes the cost to packages, extensions, tools, skills, and context files.
Replaces the former `/context` command and its subcommands.

- **Findings** - ranked problems with suggested fixes.
- **Fixed overhead** - system prompt, tool declarations, skills list, context files, and extension prompt sections, grouped by source.
- **Conversation** - messages, replies, thinking, tool calls/results, `!` bash output, injected messages, and summaries.
- **Largest items**, **tool results by tool**, **repeated calls**, and **provider-measured jumps** between requests.

Uses Pi's canonical session projection, including compaction and context edits.
Character counts are exact; token estimates are calibrated to provider counts when available, otherwise use 4 chars/token.
Opaque thinking signatures are reported separately rather than priced.

In the TUI, the report opens in a full-screen overlay:

- `↑` / `↓`, `j` / `k` - line scroll
- `PgUp` / `PgDn`, `b` / `space` / `f` - page scroll
- `g` / `Home`, `G` / `End` - jump top/bottom
- `q` / `Esc` / `Enter` - close

Outside the TUI, the report is sent as a notification.
The report is never added to the model context.
It includes paths and short previews of messages and tool arguments, which may contain sensitive information.
Redact before sharing.

See [context-audit's module guide](./extensions/context-audit/README.md) for details.

### `/preview`

Render a markdown file inside a scrollable overlay using Pi's own markdown renderer and the active theme.
What you see matches how Pi renders assistant output.

```text
/preview <path>
```

- `<path>` may be relative to the cwd, absolute, or start with `~`.
- If the final path segment has no extension, `.md` is appended (`/preview CONTRIBUTING` finds `CONTRIBUTING.md`).

Key bindings:

- `↑` / `↓`, `j` / `k` - line scroll
- `PgUp` / `PgDn` - page scroll
- `g` / `Home`, `G` / `End` - jump top/bottom
- `r` - reload the file from disk
- `Esc` / `q` - close

Limits:

- Files over 512 KiB are rejected.
- TUI mode only.
- Read-only; overlay content is never added to the model context.

### Custom footer

Richer footer status for the active session, including response timing and cache-freshness heuristics.
Cumulative token and cost totals cover the whole session, including abandoned branches, assistant and tool-result usage, standalone usage, compaction, and branch summaries.
Nested tool usage is counted only through its recorded parent result, matching Pi's accounting.
Response speed and cache freshness still track assistant responses separately.

`PI_CACHE_RETENTION=long` switches the cache TTL heuristic to the longer retention window.

### Welcome header

Replaces the stock TUI header with the pi logo, key tips, the active model, and loaded resources (context, skills, prompts, extensions, themes).
Stock resource-panel sections are hidden so they are not listed twice.

TUI mode only.
Use the expand-tools binding (`ctrl+o` by default) to show the full resource lists.

### Dracula theme

Ships the `dracula` theme.
Select it with `/settings` or in settings:

```json
{
  "theme": "dracula"
}
```

If you already have a local `dracula` theme, remove or rename that file so the package copy is the one pi loads.

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
      "extensions": ["extensions/context-audit/index.ts"]
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

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": ["extensions/welcome-header.ts"]
    }
  ]
}
```

Theme only:

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": [],
      "themes": ["themes/dracula.json"]
    }
  ]
}
```

## Source

```text
extensions/cd-command.ts
extensions/cd-helpers.mjs
extensions/context-audit/index.ts
extensions/context-audit/          # report analysis, rendering, and viewer modules
extensions/context-scroll.mjs     # shared by /preview
extensions/custom-footer.ts
extensions/preview-command.ts
extensions/welcome-header.ts
extensions/welcome-header-helpers.mjs
themes/dracula.json
```
