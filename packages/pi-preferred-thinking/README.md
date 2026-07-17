# @zenspc/pi-preferred-thinking

Model-specific thinking level preferences for the [Pi coding agent](https://pi.dev).

Pi's built-in `defaultThinkingLevel` is global.
This extension lets each model keep its own preferred level.
Invalid or missing values are ignored.

## Install

```bash
pi install npm:@zenspc/pi-preferred-thinking
```

Local development:

```bash
pi -e ./packages/pi-preferred-thinking
pi install ./packages/pi-preferred-thinking
```

## Config

```text
$PI_CODING_AGENT_DIR/extensions/preferred-thinking.json
# default:
~/.pi/agent/extensions/preferred-thinking.json
```

Example:

```json
{
  "anthropic/claude-opus-4-6": "high",
  "openai/gpt-5.2": "medium",
  "google/gemini-2.5-pro": "low"
}
```

Keys are `provider/id`.
Valid levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Rules:

- Missing models are left alone (current/session level stays).
- Invalid levels and malformed keys are dropped on load.
- Malformed or missing files act like an empty map.

## When preferences apply

Applied when:

- You switch models via `/model`, model picker, or Ctrl+P (`model_select` sources `set` / `cycle`).
- A new session starts (`session_start` reasons `startup` / `new`) and no CLI thinking override is present.

Not applied when:

- Resuming, forking, or reloading a session (session history wins).
- Startup used `--thinking <level>` or `--model provider/id:<level>`.
- The model has no mapping, or the mapping is invalid.

Notes:

- Pi still clamps levels to what the active model supports.
- `pi.setThinkingLevel()` also updates Pi's global default thinking level (same as Shift+Tab).
- Explicit scoped `provider/model:thinking` values used with `--models` are overwritten by a preferred mapping when you cycle to that model.

## Commands

```text
/preferred-thinking
/preferred-thinking show
/preferred-thinking list
/preferred-thinking set <level>
/preferred-thinking clear
/preferred-thinking reload
/preferred-thinking help
```

- `set` saves the preference for the **current** model and applies it immediately.
- `clear` removes the stored mapping only; the live thinking level is unchanged.
- `reload` re-reads the JSON file from disk.

## Security notes

This extension only reads and writes a local preference JSON file under the Pi agent directory.
It does not make network calls, run shell commands, or handle credentials.

Untrusted config is treated as hostile input:

- File size is capped (`100_000` bytes).
- Entry count and key length are capped.
- Levels are allowlisted.
- Dangerous object keys (`__proto__`, `constructor`, `prototype`) are rejected.
- Parsed maps use a null prototype; lookups use own-property checks.

Like all Pi extensions, it runs with full local permissions of the Pi process.

## Source

```text
extensions/preferred-thinking.ts
extensions/preferred-thinking-helpers.mjs
```
