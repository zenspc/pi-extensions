# Pi Extensions

Installable packages for the [Pi coding agent](https://pi.dev), published under `@zenspc`.

## Packages

| Package | Install | What you get |
|---|---|---|
| [`@zenspc/pi-safety`](./packages/pi-safety) | `pi install npm:@zenspc/pi-safety` | Confirm destructive bash/git actions |
| [`@zenspc/pi-workflow`](./packages/pi-workflow) | `pi install npm:@zenspc/pi-workflow` | Plan mode + tracked execution |
| [`@zenspc/pi-devtools`](./packages/pi-devtools) | `pi install npm:@zenspc/pi-devtools` | `/context` report + richer footer |

## Local development

```bash
pnpm check

# try one package without publishing
pi -e ./packages/pi-safety
pi -e ./packages/pi-workflow
pi -e ./packages/pi-devtools

# install from path into user settings
pi install ./packages/pi-safety
pi install ./packages/pi-workflow
pi install ./packages/pi-devtools
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

`herdr-agent-state` stays local.
It is managed by Herdr and is not part of this monorepo.

## Docs

- [Contributing](./docs/contributing.md)
- [Publishing](./docs/publishing.md)

## License

MIT
