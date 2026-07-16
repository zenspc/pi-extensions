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

## Limitations

This extension is a **best-effort confirmation layer**, not a security product claim.

- It confirms a fixed set of destructive or risky patterns. That set is not exhaustive.
- Novel or rephrased commands can slip through the heuristics.
- It can be disabled by the user via `~/.pi/agent/safety-guard.json` (`"enabled": false`).
- It does not isolate the filesystem, network, or credentials.
- It does not replace code review, backups, branch protection, or OS-level isolation.
- Like all Pi extensions, it runs with full local permissions.

Avoid treating it as "makes Pi safe" or as a complete deny-list.

## Source

Extension entry:

```text
extensions/safety-guard.ts
```
