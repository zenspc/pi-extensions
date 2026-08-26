# @zenspc/pi-browser

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
