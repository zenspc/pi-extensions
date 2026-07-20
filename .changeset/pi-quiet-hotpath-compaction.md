---
"@zenspc/pi-quiet": patch
---

Keep settled Compaction Groups across trailing pending same-kind tools and cut TUI invalidate thrash.

Settled success/soft neighbors stay folded while a trailing same-kind tool runs; the group grows only after that tool settles. Live index updates are single-writer via `tool_execution_*` events. O(1) row lookup, paint-only invalidates, lighter line counting, and retain result bodies only for quiet success|soft rows.
