# Quiet Display ships as an extension package first

Pi's Stock Display dumps too much tool chrome and output for many new users.
We will productize Quiet Display as `@zenspc/pi-quiet` in this monorepo before proposing it as a Pi core default.

An extension lets us iterate on Quiet Rows, breakthrough rules, and sticky on/off without blocking on core review, while staying close to supported APIs (`renderCall` / `renderResult`, thin `renderShell`) so the design can move upstream later.

We rejected starting in Pi core: the right default presentation needs real-world install dogfooding, and core PRs are a slow place to discover edge cases (partials, override warnings, coexistence with other tool overrides).

We also rejected a permanent pure-extension dead end: the package should stay upstream-shaped, not a pile of private monkey-patches.
