---
"@zenspc/pi-quiet": patch
"@zenspc/pi-devtools": patch
---

Fix Quiet renderer composition using Pi's shipped resolver API, including stock display and expanded output.
Use the canonical session projection for context reports and prefer measured aggregate usage over estimates.
Include all recorded usage sources across the whole session in footer totals, without counting nested tool usage twice.
