# context-audit

`/ctx` shows what fills the context window and who is responsible.
The report opens in a full-screen overlay and never enters the model context.
Scroll with ↑↓ / j k / PgUp PgDn / g G. Close with q, Esc, or Enter.
Outside the TUI the same report is sent as a notification.

## What it reports

- **Findings**: ranked problems with the lever that fixes each one.
- **Fixed overhead**: system prompt, tool declarations, skills list, context files, and extension prompt sections.
  These are paid on every request.
  Each item is attributed to its package, extension directory, or MCP server.
- **Conversation**: user messages, replies, thinking, tool calls, tool results, `!` bash output, extension-injected messages, and summaries.
- **Largest items**: biggest fixed items and biggest conversation blocks, with the turn they arrived in.
- **Tool results by tool**, **repeated calls**, and **biggest jumps between requests** (measured by the provider).

## How sizes are computed

Characters are exact.
Tokens are priced per part, because tokens per character differ by model and by content (prose, JSON, code).
Opaque thinking signatures are not priced, because only some providers count them. Their volume is reported as a finding.
When the provider has reported a context size, the fixed overhead is priced from the first request and the conversation from the remainder.
Otherwise everything uses 4 characters per token, and the header says so.

## Layout

| File | Role |
|---|---|
| `index.ts` | Registers `/ctx`. |
| `snapshot.ts` | The only module that reads Pi state. |
| `setup.ts` | Splits the system prompt and attributes each part. |
| `conversation.ts` | Splits messages into costed blocks and turns. |
| `calibrate.ts` | Fits token rates to the provider's count. |
| `report.ts`, `findings.ts` | Aggregation and advice. |
| `render.ts`, `viewer.ts` | Layout and the scrollable overlay. |
