# @zenspc/pi-quiet

Quiet Display for the [Pi coding agent](https://pi.dev): dense rows for tool activity, so new (and tired) users are not drowned in tool chrome and stdout.

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
| `read` | `📖 read path · N lines` | Image reads chip as `image` |
| `grep` / `find` / `ls` | Kind Emoji + target + count | Zero hits = Soft Breakthrough (compact, not an alarm) |
| `edit` | `✏️ edit path · +N -M` | Diff body on expand |
| `write` | `📝 write path · N lines` | |
| `bash` | `💻 $ cmd · exit 0` | Stdout hidden on success; non-zero = Hard Breakthrough |
| Foreign Tools | `🧩 name peek · ok` | Generic Kind Formatter when Pi exposes `registerToolRenderer` |

### Run Compaction

Adjacent settled successes (and Soft Breakthroughs) of the **same tool name** fold into one Compaction Group:

```text
📖 read ×3
  • ~/a.ts · 40 lines
  • ~/b.ts · 12 lines
  • ~/c.ts · 8 lines
```

- **Strict neighbors only** - assistant/user prose or a different tool name splits groups.
- **Hard Breakthrough** never joins a group and splits runs before/after.
- **Pending never joins** - a running tool stays a singleton Quiet Row. Already-settled same-kind neighbors **stay** compacted while a trailing same-kind tool is still running; the Compaction Group grows only after that tool settles successfully (or soft).
- **Expand** expands the whole group to stacked Stock Display bodies.
- Groups are **rebuilt from session history** after reload.

## Behavior notes

- **While running:** static pending marker only (no live stdout firehose).
- **Tool Shell Background:** visible Quiet Rows and Compaction Groups keep Stock's pending/success/error strip so all tools match. Hidden compaction members stay zero-height.
- **Hard Breakthrough:** failed edit/write, bash non-zero / thrown error, Foreign `failed` - chip + capped error tail without you expanding.
- **Expand** (pi's normal expand gesture): full Stock Display body for that row (or whole Compaction Group), including the original Foreign Tool renderer. Expand does **not** change the Sticky Preference.
- **`/quiet`:** Sticky Preference only; renders follow the current preference when components redraw.

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

## Scope

**In (always):** built-in `read`, `bash`, `edit`, `write`, `find`, `grep`, `ls` (specialized Kind Formatters + Run Compaction).

**In (when Pi has `registerToolRenderer`):** Foreign Tools - extension tools, MCP gateways, SDK custom tools - via the Generic Kind Formatter (`🧩`, arg peek, `ok` / `empty` / `failed`) and Run Compaction by exact tool name.

**Out:** assistant prose, thinking, startup header, second density preference, durations on chips.

Without the upstream Tool Renderer Wrapper seam (`registerToolRenderer` on Pi's ExtensionAPI), Foreign Tools stay on Stock Display (built-ins still Quiet).

## Security notes

- Config is untrusted input: size-capped, regular-file only (no symlinks), atomic `0o600` writes.
- TUI chrome only. No network. Does not change tool execution semantics - only presentation.
- Foreign arg peeks skip secret-ish keys (`token`, `password`, `api_key`, …).
- Overriding built-ins (fallback path without the renderer hook) makes pi show its normal tool-override warning once; that is expected. With the hook, Quiet does not replace tools.

## License

MIT
