---
"@zenspc/pi-devtools": patch
---

Fix custom footer thinking level stuck on `high` for new sessions by reading the live session level via `pi.getThinkingLevel()`, and map `xhigh`/`max` color tokens correctly.
