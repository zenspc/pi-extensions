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
- `prompt`
- `memory [substr]`
- `tools`
- `json`

Overlay content is never added to the model context.

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
