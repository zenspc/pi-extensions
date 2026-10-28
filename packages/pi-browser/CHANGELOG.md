# @zenspc/pi-browser

## 0.6.0

### Minor Changes

- 66101a6: Harden browser automation and keep one active Pi Attachment per User Data Dir.
  Concurrent sessions now require separate directories; normal shutdown releases the lease without closing Chrome, and crash recovery is documented.

  Replace page-marker ownership with persisted Chrome target IDs, isolate extension state, serialize approvals and operations, and recheck approval at execution and completion.
  Use native document interception with service-worker bypass instead of proxying response bodies, preserving Chrome's normal subresource cache.

  Add cancellable page-operation deadlines, synchronous infinite-loop recovery, bounded JSON-safe evaluation output, and DOM-backed Snapshot Refs that cannot be reused after navigation or element replacement.
  Improve Snapshot text, headings, shadow-root support, hidden-element filtering, and password-name handling.
  Load Playwright only when attaching, share private atomic configuration writes, and preserve invalid Allowlist files instead of overwriting them.

  Require Node.js 22.18 or newer, validate against Pi 1.4.0, and add package type checking and expanded real-Chrome regression coverage.

## 0.5.0

### Minor Changes

- 2eaac4c: Add `/browser` to switch sticky Tool Availability. Off hides Browser Tools from the model without touching Chrome, the Attachment, or Domain Approval.

## 0.4.0

### Minor Changes

- 6713cb9: Abort unapproved top-level navigation in the Automation Tab. A tool call that hops off the approved set restores the previous URL and fails. Spontaneous hops abort in place.
- 6713cb9: Compute Registrable Domain from the Public Suffix List. Non-http(s) URLs fail closed. `about:blank` is allowed without a grant.

## 0.3.0

### Minor Changes

- 9e5bb24: Attach to a leftover dedicated Chrome instead of launching a second window. Delete a stale User Data Dir lock, and fail with a quit-window error when a live Chrome has no Debug Port.

## 0.2.0

### Minor Changes

- 360c3dc: Launch a headed system Chrome against the dedicated User Data Dir on the first tool call. Discover an ephemeral Debug Port from that dir instead of attaching to port 9222. Leave the window running when Pi exits.

## 0.1.0

### Minor Changes

- dc3e4c4: Add `@zenspc/pi-browser`: attach to your running Chrome over CDP and drive one owned Automation Tab with six tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_evaluate`). Every tool call passes a per-domain approval gate with Approve once / Approve permanently / Deny; permanent grants persist to an Allowlist file and subdomains inherit the parent domain's approval.
