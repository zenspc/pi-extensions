# @zenspc/pi-devtools

Context usage report and richer session footer for Pi.

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
extensions/context-command.ts
extensions/custom-footer.ts
```
