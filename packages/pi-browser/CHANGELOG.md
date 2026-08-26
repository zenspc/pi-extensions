# @zenspc/pi-browser

## 0.1.0

### Minor Changes

- dc3e4c4: Add `@zenspc/pi-browser`: attach to your running Chrome over CDP and drive one owned Automation Tab with six tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_evaluate`). Every tool call passes a per-domain approval gate with Approve once / Approve permanently / Deny; permanent grants persist to an Allowlist file and subdomains inherit the parent domain's approval.
