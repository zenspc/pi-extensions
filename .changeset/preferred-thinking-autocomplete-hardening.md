---
"@zenspc/pi-preferred-thinking": minor
---

Improve preferred-thinking UX and packaging, and harden config I/O.

- Register only the real extension entry so helpers/tests are not loaded as extensions
- Add tab completion for subcommands and levels (`set high` keeps the `set` token)
- Bare `/preferred-thinking` shows help
- Atomic config save with mode `0o600`; load ignores symlinks and non-regular files
- Migrate helpers/tests from `.mjs` to TypeScript
