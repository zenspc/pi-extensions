# @zenspc/pi-btw

Claude Code-style `/btw` side questions for Pi.
Chat about the current conversation in an inline bottom panel while the main agent keeps working.
Neither the side question nor its answer enters the main transcript.
`/side` is an exact alias for `/btw`, with the same temporary history.

Requires Pi 1.4.0 or newer in interactive terminal mode.

## Install

From this repository:

```bash
pi install ./packages/pi-btw
```

Run `/reload` in Pi after installation or updating the extension.
To try it without installing:

```bash
pi -e ./packages/pi-btw
```

## Use

```text
/btw Why did you recommend option B?
# Equivalent:
/side Why did you recommend option B?
```

The panel streams an independent answer from your selected model.
It works while the main agent is responding or executing tools.
The panel temporarily replaces the main editor, below the main transcript rather than over it.
The main agent continues working above the panel.
Long answers scroll within a compact view capped at 16 lines, using roughly half the terminal height on smaller terminals.
There is no session switch, fork, tool execution, or change to the main agent's tool settings.

Type follow-up questions directly into the input at the bottom of the panel and press Enter to send.
The reply streams in the same panel and remembers the earlier side exchanges.
There is no need to close it or run another command between messages.
You can draft the next question while an answer streams; if you press Enter too soon, the draft stays in the input until you send it after the answer finishes.

Press Escape to close the panel and restore the main editor.
Dismissing it does not cancel the side request or the main agent.
Run `/btw` or `/side` without a question to reopen the chat, including an answer still in progress, or start an empty chat when there is no history.
You can also ask follow-ups with another `/btw <question>` or `/side <question>` command.
Each request gets the current conversation snapshot and up to 20 successful exchanges from the retained side history.
The panel retains up to 20 exchanges, shows recent earlier questions when space allows, and lets you browse answers.
Only one side request runs at a time; another question while one is running reopens it rather than queuing a second request.

| Key | Action |
|---|---|
| Enter | Send the question in the side-chat input |
| Escape | Dismiss without interrupting either request |
| Up / Down | Scroll the answer |
| Page Up / Page Down | Scroll one page |
| Shift+Left / Shift+Right | Browse earlier / later answers |
| Shift+Tab / Tab | Alternative answer-navigation keys |
| Alt+C | Copy the displayed answer as raw Markdown |
| Alt+X | Clear all side history and dismiss; cancel only an active side request |

Space, `c`, `x`, `[` and `]` are ordinary text in the input, not panel shortcuts.
Text editing uses Pi's standard single-line input component.
Unsent drafts are discarded when the panel is dismissed.
Custom Pi selection-cancel and up/down keybindings also work.

## Context, privacy, and lifetime

- The snapshot includes finalized conversation entries, earlier tool results, images, compaction summaries, and context edits.
  It excludes the response currently streaming and does not include unsent main-editor text.
  Historical tool calls become reference text; no tools are declared or executed for side requests.
- The side model cannot inspect new files, search the web, or modify the project.
  It answers from the supplied context only.
  The main agent retains its normal tools and may still modify files while you read the panel.
- Side history is memory-only and is not saved through Pi's session APIs.
  It disappears on exit, `/reload`, or a session switch.
  It does not appear in `/resume`, session exports, or future main-agent requests.
  Pi's normal `/tree` navigation does not merge side history into the main conversation.
- Side requests use Pi's configured provider and credentials, with their own abort signal and a five-minute timeout.
  They incur normal provider charges and can share provider rate limits with the main request.
  They do not add usage entries to the main session totals.
  Reuse of the main request's prompt cache is not guaranteed because the side request has a tool-free prompt.
- As with any model request, the supplied context and side questions go to your configured provider.
  Memory-only storage here does not override provider-side retention or external diagnostics.

## Differences from Claude Code

Like Claude Code's `/btw`, side questions use independent tool-free requests with temporary history.
Instead of a popup overlay, this extension uses an inline bottom panel with its own input for follow-up questions, reopening, scrolling, copying, and clearing.
Claude Code's optional `f` shortcut for promoting an answer into its background-subagent interface is not included; Pi does not provide that same interface.
There is no VS Code panel or teammate-transcript integration.

This replaces the earlier saved-session `/discuss` prototype.
Use `/btw` now; there is no `/discuss back` step.
Any sessions created with the old prototype remain normal Pi sessions and can be opened through `/resume`.

## Development

```bash
pnpm --filter @zenspc/pi-btw check
pnpm --filter @zenspc/pi-btw test
```

Tests use Pi's real session runtime and a controlled model provider, without external API requests.
They cover in-panel follow-ups, draft handling, alias sharing, concurrent main/side generation, transcript isolation, streaming, history, context projection, errors, no-tool enforcement, shutdown, and panel controls.
