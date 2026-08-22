---
"@zenspc/pi-safety": patch
---

Harden Safety Guard classification and confirmation flow.

- Detect git subcommands with global options between git and the subcommand (e.g. `git -C path push --force`)
- Match short flag clusters for `rm` (e.g. `rm -fr`), and only classify flags after the last `rm` word
- Expand protected paths to `.envrc`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.config/gcloud`, and `.config/gh`
- Destructive-severity risks always require UI confirmation; user message wording can no longer auto-allow them, only risky system changes
- Write config atomically via temp file + rename with best-effort cleanup on failure
