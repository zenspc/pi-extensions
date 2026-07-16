# @zenspc/pi-safety

Confirm destructive bash and git actions before Pi runs them.

## Install

```bash
pi install npm:@zenspc/pi-safety
```

Local development:

```bash
pi -e ./packages/pi-safety
pi install ./packages/pi-safety
```

## What it does

Intercepts risky tool calls and asks for confirmation before allowing them.

Examples of guarded actions:

- `rm -rf` and other destructive shell deletes
- force push / hard reset / commit amend style git history rewrites
- other high-risk bash patterns classified by the extension

## Commands / config

Config file:

```text
~/.pi/agent/safety-guard.json
```

Default:

```json
{
  "enabled": true
}
```

## Security notes

This extension runs with full local permissions, like all Pi extensions.
It reduces accidental damage.
It is not a sandbox and does not replace project trust or OS-level isolation.

## Source

Extension entry:

```text
extensions/safety-guard.ts
```
