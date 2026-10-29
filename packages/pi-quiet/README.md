# @zenspc/pi-quiet

A Grok Build-inspired terminal presentation for the [Pi coding agent](https://pi.dev).
Quiet replaces the welcome header, prompt, footer, palette, and tool activity display while keeping Pi's execution and keyboard controls.
It is on by default.

## Install

```bash
pi install npm:@zenspc/pi-quiet
```

Requires Pi 1.4 or newer, including its public tool-renderer hook.
For local development:

```bash
pi -e ./packages/pi-quiet
```

Extensions that replace the same header, footer, editor, or working indicator are last-writer-wins.
For the closest match, disable overlapping presentation extensions in `pi config`.
Quiet preserves an editor factory already installed when Quiet takes over, and restores it when disabled.

## Presentation

- A restrained neutral palette with violet accents, warm file targets, and muted details.
- A responsive Pi welcome card that becomes a compact location header once a conversation starts.
- A boxed prompt with a model/reasoning label, native autocomplete, multiline input, paste, history, and IME support.
- A compact footer showing git branch, context use, configured keyboard hints, and other extensions' status messages.
- Verb-first tool activity without emoji or success-background panels.

```text
• Read 4 files
  │ … 1 earlier
  ├ src/index.ts (40 lines)
  ├ src/model.ts (120 lines)
  ├ src/render.ts (90 lines)

• Searched 2 patterns
  ├ QuietModel (3 matches)
  ├ *.test.ts (8 files)

• Edited src/index.ts (+3 -1)
• Ran pnpm test
× Ran pnpm build (exit 1)
  Error: missing export
```

Running tools use present tense and suppress live stdout.
Failures remain separate and show the last 12 logical output lines automatically, capped at 8,000 characters.
Commands, edits, writes, unknown tools, and image results never fold.
Adjacent completed reads, searches, and listings fold only within their semantic kind and never across visible user, assistant, or thinking content.
Collapsed groups show the three most recent members; expansion shows every retained member with its own original tool renderer.

Pi's configured expand gesture, normally `Ctrl+O`, reveals full output without changing the preference.
Inline images remain owned by Pi and stay separate from groups.
Session resume, branch navigation, and compaction reconstruct grouping from the active transcript.
Parallel tools retain call order rather than completion order.

## Commands

| Command | Effect |
|---|---|
| `/quiet` | Toggle Quiet presentation |
| `/quiet on` | Enable Quiet presentation |
| `/quiet off` | Restore native header, footer, editor, and palette |
| `/quiet status` | Show preference and config path |
| `/quiet help` | Show help |

Toggling redraws existing tool activity as well as terminal chrome.
Turning Quiet off restores the previous theme unless you deliberately selected another theme while Quiet was active.
The Quiet palette is transient and does not overwrite your saved theme setting.
Missing header/footer/working-indicator getters in Pi mean those surfaces restore to native defaults, not another extension's previous replacements.

## Preference

The existing preference file remains compatible:

```text
~/.pi/agent/extensions/quiet.json
```

With `PI_CODING_AGENT_DIR`, the path is `$PI_CODING_AGENT_DIR/extensions/quiet.json`.

```json
{
  "enabled": true
}
```

Missing or invalid configuration defaults to on.
Preference writes are atomic with mode `0600`; oversized files, symlinks, and non-regular paths are rejected.

## Fidelity and scope

This is inspired by Grok Build's terminal interface, not a replacement agent or a copy of its branding.
Quiet keeps Pi's models, permissions, tools, cancellation, message queueing, and configured shortcuts.
It does not claim Grok's dashboard, cloud features, agent orchestration, or per-entry keyboard navigation.
Pi's native user and assistant message layouts remain, styled by the shared palette, because Pi does not expose replacement hooks for those messages.
The terminal's own default background remains under terminal control.

No tool definitions are overridden, no transcript is rewritten, and no model-facing arguments or results are changed.
Quiet makes no network requests.
Terminal-only chrome is installed only in TUI mode; RPC and print execution stay native.
Unknown-tool summaries show only known descriptive fields, never arbitrary argument values.

## Development

```bash
pnpm --filter @zenspc/pi-quiet test
pnpm check
```

Tests cover transcript ordering, group boundaries, cancellation history, mixed-tool expansion, delegated renderer state, preference compatibility, Unicode widths, IME markers, native editor shortcuts, and restoration.

## License

MIT
