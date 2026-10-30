# Pi Extensions

Installable packages for the [Pi coding agent](https://pi.dev), published under `@zenspc`.

> Unmaintained extensions are preserved in [`packages/archived/`](./packages/archived).
> See the [archive README](./packages/archived/README.md) for their status and limitations.

## Packages

| Package | Install | What you get |
|---|---|---|
| [`@zenspc/pi-autopilot`](./packages/pi-autopilot) | `pi install npm:@zenspc/pi-autopilot` | Autonomous task DAGs, isolated workers, verification, review, and quota recovery |
| [`@zenspc/pi-browser`](./packages/pi-browser) | `pi install npm:@zenspc/pi-browser` | Drive a dedicated Chrome with per-domain approval |
| [`@zenspc/pi-devtools`](./packages/pi-devtools) | `pi install npm:@zenspc/pi-devtools` | `/ctx` context audit + richer footer |
| [`@zenspc/pi-pstack`](./packages/pi-pstack) | `pi install npm:@zenspc/pi-pstack` | pstack skills + subagents: poteto-mode playbooks, engineering principles, multi-model review panels |
| [`@zenspc/pi-quiet`](./packages/pi-quiet) | `pi install npm:@zenspc/pi-quiet` | Grok Build-inspired terminal presentation and compact tool activity |
| [`@zenspc/pi-spinner`](./packages/pi-spinner) | `pi install npm:@zenspc/pi-spinner` | Customize the spinner animation and rotate the loader message |

Pre-1.0 APIs may change.

## Security notes

- **pi-devtools**: `/ctx` reports include paths and short previews of messages and tool arguments, which may contain secrets or PII.
  Redact before sharing reports.
- **pi-spinner**: treats config files as untrusted input (size caps, symlink refusal, ANSI stripping). Local TUI chrome only; no network or credentials.
- **pi-quiet**: presentation-only terminal chrome and tool-renderer wrappers using public Pi hooks.
  Config is untrusted input (size caps, symlink refusal).
  Does not change tool execution, permissions, model-facing messages, or saved theme settings.
- **pi-pstack**: executable extension code manages mode state, model roles, and skill visibility.
  Bundled skills, agent definitions, and scripts can instruct the model to delegate work and run project commands.
  Review before installing.
- **pi-browser**: launches a dedicated Chrome against its own User Data Dir and acts on approved domains. `browser_evaluate` runs arbitrary page JavaScript; snapshots and screenshots can capture sensitive page content.
- **pi-autopilot**: executes unattended worker and verification commands with your user permissions and creates local Git checkpoints.
  Worktrees and file reservations gate publication but are not an OS sandbox.
  Use a disposable repository for your first run; see the package README for model configuration and recovery.

See each package README and [SECURITY.md](./SECURITY.md) for details.

## Local development

```bash
pnpm check

# try one package without publishing
pi -e ./packages/pi-devtools
pi -e ./packages/pi-spinner
pi -e ./packages/pi-quiet
pi -e ./packages/pi-pstack
pi -e ./packages/pi-browser
pi -e ./packages/pi-autopilot

# install from path into user settings
pi install ./packages/pi-devtools
pi install ./packages/pi-spinner
pi install ./packages/pi-quiet
pi install ./packages/pi-pstack
pi install ./packages/pi-browser
pi install ./packages/pi-autopilot
```

## Pick pieces from a package

Example: install only the context command from devtools.

```json
{
  "packages": [
    {
      "source": "npm:@zenspc/pi-devtools",
      "extensions": ["extensions/context-audit/index.ts"]
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
