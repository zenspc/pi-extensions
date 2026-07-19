---
"@zenspc/pi-spinner": patch
---

Harden spinner config IO against untrusted project files: size caps, symlink refusal, atomic 0o600 writes, ANSI/control stripping, allowlisted keys/presets, and message/frame bounds.
