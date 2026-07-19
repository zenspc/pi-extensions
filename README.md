# Pi Extensions

Installable packages for the [Pi coding agent](https://pi.dev), published under `@zenspc`.

## Packages

| Package | Install | What you get |
|---|---|---|
| [`@zenspc/pi-safety`](./packages/pi-safety) | `pi install npm:@zenspc/pi-safety` | Confirm destructive bash/git actions |
| [`@zenspc/pi-workflow`](./packages/pi-workflow) | `pi install npm:@zenspc/pi-workflow` | Plan mode + tracked execution |
| [`@zenspc/pi-devtools`](./packages/pi-devtools) | `pi install npm:@zenspc/pi-devtools` | `/context` report + richer footer |
| [`@zenspc/pi-preferred-thinking`](./packages/pi-preferred-thinking) | `pi install npm:@zenspc/pi-preferred-thinking` | Per-model thinking level preferences |
| [`@zenspc/pi-copilot-discovery`](./packages/pi-copilot-discovery) | `pi install npm:@zenspc/pi-copilot-discovery` | Live GitHub Copilot model discovery |
| [`@zenspc/pi-spinner`](./packages/pi-spinner) | `pi install npm:@zenspc/pi-spinner` | Customize the spinner animation and rotate the loader message |
| [`@zenspc/pi-quiet`](./packages/pi-quiet) | `pi install npm:@zenspc/pi-quiet` | Quiet Display - dense built-in tool rows |
| [`@zenspc/pi-sticky-editor`](./packages/pi-sticky-editor) | `pi install npm:@zenspc/pi-sticky-editor` | Keep the editor and footer fixed while the transcript scrolls |

Pre-1.0 APIs may change.

## Security notes

- **pi-devtools**: full prompt/memory dumps can contain secrets, tokens, or PII. Prefer `/context json` when sharing reports, and redact before pasting into issues.
- **pi-copilot-discovery**: reuses your existing GitHub Copilot credentials and may enable model policies on your Copilot account after login.
- **pi-safety**: best-effort confirmation for known risky patterns. It is not a sandbox or a complete deny-list.
- **pi-workflow**: plan mode is a workflow aid, not a hard security boundary.
- **pi-spinner**: treats config files as untrusted input (size caps, symlink refusal, ANSI stripping). Local TUI chrome only; no network or credentials.
- **pi-quiet**: presentation-only override of built-in tool rendering. Config is untrusted input (size caps, symlink refusal). Does not change tool execution.
- **pi-sticky-editor**: presentation-only TUI layout change (fixed editor region). Patches private Pi TUI internals; no network, credentials, or tool-execution changes.

See each package README and [SECURITY.md](./SECURITY.md) for details.

## Local development

```bash
pnpm check

# try one package without publishing
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools
pi -e ./packages/pi-preferred-thinking
pi -e ./packages/pi-copilot-discovery
pi -e ./packages/pi-spinner
pi -e ./packages/pi-quiet
pi -e ./packages/pi-sticky-editor

# install from path into user settings
pi install ./packages/pi-safety
pi install ./packages/pi-workflow
pi install ./packages/pi-devtools
pi install ./packages/pi-preferred-thinking
pi install ./packages/pi-copilot-discovery
pi install ./packages/pi-spinner
pi install ./packages/pi-quiet
pi install ./packages/pi-sticky-editor
```

## Pick pieces from a package

Example: install only the context command from devtools.

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

Use `pi config` to enable or disable individual resources after install.

## Not included

Other local-only packages are intentionally not published from this monorepo.

## Docs

- [Contributing](./CONTRIBUTING.md) ([detailed guide](./docs/contributing.md))
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Publishing / release model](./docs/publishing.md) (changesets → Version PR → tags → npm + GitHub Release)

## License

MIT
