# @zenspc/pi-safety

## 0.1.2

### Patch Changes

- 8a2bc73: Harden Safety Guard classification and confirmation flow.

  - Detect git subcommands with global options between git and the subcommand (e.g. `git -C path push --force`)
  - Match short flag clusters for `rm` (e.g. `rm -fr`), and only classify flags after the last `rm` word
  - Expand protected paths to `.envrc`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.config/gcloud`, and `.config/gh`
  - Destructive-severity risks always require UI confirmation; user message wording can no longer auto-allow them, only risky system changes
  - Write config atomically via temp file + rename with best-effort cleanup on failure

## 0.1.1

### Patch Changes

- 623116b: Perf and packaging fixes for always-on footer and safety-guard.

  - Footer: O(1) incremental usage totals, stop idle timer at cache TTL, show context as used/limit tokens
  - Safety: cache git-repo probe per session, shorter system prompt, register only the factory entry (helpers/tests are not extensions)
