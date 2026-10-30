# Archived extensions

These extensions are no longer maintained.
Their source is preserved here for reference, but they receive no bug fixes, security updates, or compatibility updates.
Previously published npm versions remain installable; archiving does not unpublish them.

| Package | What it did | Status |
|---|---|---|
| [`@zenspc/pi-copilot-discovery`](./pi-copilot-discovery) | Live GitHub Copilot model discovery | Now officially supported by Pi |
| [`@zenspc/pi-preferred-thinking`](./pi-preferred-thinking) | Per-model thinking level preferences | Now officially supported by Pi |
| [`@zenspc/pi-safety`](./pi-safety) | Confirm destructive bash and git actions | Unmaintained |
| [`@zenspc/pi-sticky-editor`](./pi-sticky-editor) | Keep the editor and footer fixed while the transcript scrolls | Now officially supported by Pi |
| [`@zenspc/pi-workflow`](./pi-workflow) | Plan mode and tracked execution | Unmaintained |

## Repository behavior

Archived packages are excluded from the pnpm workspace, routine checks and tests, releases, and the root package's default extension loading.
Their READMEs describe historical behavior and may not match current Pi releases.
Use Pi's built-in functionality where available.

For reference only, an archived extension can be loaded explicitly from a local checkout:

```bash
pi -e ./packages/archived/pi-safety
```

## Security notes

- **pi-copilot-discovery** reuses GitHub Copilot credentials and may enable model policies on your account after login.
- **pi-preferred-thinking** reads and writes local thinking-level preferences.
- **pi-safety** is a best-effort confirmation layer, not a sandbox or a complete deny-list.
- **pi-sticky-editor** patches private Pi TUI internals and may break with newer Pi versions.
- **pi-workflow** provides workflow restrictions, not a hard security boundary.

Review the source and each package README before using archived code.
See the [main README](../../README.md) for maintained packages and the [security policy](../../SECURITY.md) for reporting vulnerabilities privately.
