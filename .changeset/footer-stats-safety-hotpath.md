---
"@zenspc/pi-devtools": patch
"@zenspc/pi-safety": patch
---

Perf and packaging fixes for always-on footer and safety-guard.

- Footer: O(1) incremental usage totals, stop idle timer at cache TTL, show context as used/limit tokens
- Safety: cache git-repo probe per session, shorter system prompt, register only the factory entry (helpers/tests are not extensions)
