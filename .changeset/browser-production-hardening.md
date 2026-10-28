---
"@zenspc/pi-browser": minor
---

Harden browser automation and keep one active Pi Attachment per User Data Dir.
Concurrent sessions now require separate directories; normal shutdown releases the lease without closing Chrome, and crash recovery is documented.

Replace page-marker ownership with persisted Chrome target IDs, isolate extension state, serialize approvals and operations, and recheck approval at execution and completion.
Use native document interception with service-worker bypass instead of proxying response bodies, preserving Chrome's normal subresource cache.

Add cancellable page-operation deadlines, synchronous infinite-loop recovery, bounded JSON-safe evaluation output, and DOM-backed Snapshot Refs that cannot be reused after navigation or element replacement.
Improve Snapshot text, headings, shadow-root support, hidden-element filtering, and password-name handling.
Load Playwright only when attaching, share private atomic configuration writes, and preserve invalid Allowlist files instead of overwriting them.

Require Node.js 22.18 or newer, validate against Pi 1.4.0, and add package type checking and expanded real-Chrome regression coverage.
