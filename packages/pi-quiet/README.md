# @zenspc/pi-quiet

Quiet Display for the [Pi coding agent](https://pi.dev): dense one-line rows for built-in tools, so new (and tired) users are not drowned in tool chrome and stdout.

Once installed, **Quiet Display is on by default**. Turn it off anytime with `/quiet off` (Sticky Preference).

## Install

```bash
pi install npm:@zenspc/pi-quiet
```

Local development from this monorepo:

```bash
pi -e ./packages/pi-quiet
pi install ./packages/pi-quiet
```

## What you see

| Tool | Collapsed success | Notes |
|---|---|---|
| `read` | `read path · N lines` | Image reads chip as `image` |
| `grep` / `find` / `ls` | target + count | Zero hits = Soft Breakthrough (compact, not an alarm) |
| `edit` | `edit path · +N -M` | Diff body on expand |
| `write` | `write path · N lines` | |
| `bash` | `$ cmd · exit 0` | Stdout hidden on success; non-zero = Hard Breakthrough |

- **While running:** static pending marker only (no live stdout firehose).
- **Hard Breakthrough:** failed edit/write, bash non-zero / thrown error - chip + capped error tail without you expanding.
- **Expand** (pi's normal expand gesture): full Stock Display body for that row. Expand does **not** change the Sticky Preference.
- **`/quiet`:** forward-only. Already-rendered scrollback stays as-is; new tool rows follow the preference.

## Commands

| Command | Description |
|---|---|
| `/quiet` | Toggle Quiet Display |
| `/quiet on` | Quiet Display |
| `/quiet off` | Stock Display (pi's normal tool UI) |
| `/quiet status` | Show preference + config path |
| `/quiet help` | Help |

## Config

Package-local Sticky Preference:

```text
~/.pi/agent/extensions/quiet.json
```

(or `$PI_CODING_AGENT_DIR/extensions/quiet.json`)

```json
{
	"enabled": true
}
```

Missing or invalid file → Quiet Display **on**.

## Scope (v1)

**In:** built-in `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`.

**Out:** assistant prose, thinking, MCP/extension tools, startup header, Run Compaction (adjacent same-tool merging - deferred pending platform spike).

## Security notes

- Config is untrusted input: size-capped, regular-file only (no symlinks), atomic `0o600` writes.
- TUI chrome only. No network. Does not change tool execution semantics - only presentation (and the same built-in implementations run underneath).
- Overriding built-ins makes pi show its normal tool-override warning once; that is expected.

## License

MIT
