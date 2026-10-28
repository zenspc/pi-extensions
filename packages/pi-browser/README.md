# @zenspc/pi-browser

Drive a dedicated Chrome from Pi with six Browser Tools and per-domain approval.
Chrome uses a separate User Data Dir, defaults to `~/.pi-chrome`, and stays open when Pi exits.
The extension never automatically attaches to your daily browser or an arbitrary debugging port.

## Setup

Requirements: Node.js 22.18 or newer, Pi, and a locally installed Chrome, Chromium, or Edge.
No bundled browser is downloaded.

```bash
pi install npm:@zenspc/pi-browser
```

Ask Pi to navigate to a site.
The first Browser Tool that needs a tab launches headed Chrome or attaches to the dedicated Chrome already running against this User Data Dir.
Sign in inside that window if the site needs authentication.
Logins persist in that directory.

| Environment variable | Purpose |
|---|---|
| `PI_BROWSER_USER_DATA_DIR` | Dedicated browser directory, default `~/.pi-chrome`; must be absolute after `~` expansion and must not be a filesystem root |
| `PI_BROWSER_CHROME_BIN` | Browser executable path or name on `PATH`; otherwise searches Chrome, Chromium, then Edge |
| `PI_CODING_AGENT_DIR` | Pi configuration directory, default `~/.pi/agent` |

Choose a dedicated directory, not your daily browser's profile.
WSL uses Linux Chrome; it does not launch Windows `chrome.exe` or translate Windows paths.

## Tools

| Tool | Behavior |
|---|---|
| `browser_navigate` | Navigate to an absolute HTTP(S) URL or `about:blank`; return the resulting title and URL after DOM content loads |
| `browser_snapshot` | Read a bounded, accessibility-oriented view with Element Refs such as `[ref=e12]` |
| `browser_click` | Click an Element Ref from the latest Snapshot |
| `browser_type` | Replace a referenced field's contents with the supplied text |
| `browser_screenshot` | Return a viewport PNG and its pixel dimensions |
| `browser_evaluate` | Evaluate JavaScript in the approved page and return a serialized result |

Every tool targets the Automation Tab.
Calls are serialized, approval is checked again immediately before execution, and page operations have a 30-second deadline after attachment.
Cancellation interrupts JavaScript, stops loading, and disconnects the Attachment without killing Chrome.
A later call reconnects.
Already completed clicks, submissions, or other side effects are not rolled back or automatically retried.
Chrome startup and attachment have their own bounded waits.

Snapshots include headings, readable text, native controls, ARIA roles, disabled/checked state, and open shadow roots in the main document.
They are not a complete implementation of Chrome's accessibility tree and do not expand iframe documents.
Snapshots stop at 1,000 interactive elements, 20,000 visited nodes, or approximately 50,000 text characters, with an explicit truncation notice.
Use a focused `browser_evaluate` expression when more detail is needed.

Refs point to actual DOM elements, not page-controlled attributes.
Consecutive Snapshots preserve Refs for unchanged elements, but navigation and replacement elements invalidate old Refs.
Take a new Snapshot after navigation or a layout change; never guess a Ref.
Password input values are not used as accessible names, but other visible page content can still contain secrets.

Evaluation output is capped at 50,000 characters plus a truncation notice, including in tool details.
BigInts and non-finite numbers are normalized to strings; cyclic results fall back to a string representation so session persistence remains valid.
Truncated results are not written to disk: select a smaller result in the expression instead.
Arbitrary JavaScript can still allocate memory or trigger external effects; this is not a JavaScript sandbox.

## One active Pi session per User Data Dir

One Attachment holds an exclusive lease on the directory until it disconnects.
A second Pi session cannot attach to the same directory while that lease is held.
For parallel work, set a different `PI_BROWSER_USER_DATA_DIR` for each session.

The Automation Tab is remembered by Chrome's target ID in `pi-browser-target.json` inside the directory.
Other tabs are not evaluated to detect ownership and are never driven by the Browser Tools.
If the saved target has closed, the extension creates a new Automation Tab.
Upgrading from the old page-marker implementation creates a new Automation Tab once, leaving the old tab untouched.

Normal shutdown, session replacement, and `/reload` disconnect Playwright and release the lease without closing the window.
`/browser off` only hides the tools; it does not release the lease.

### Recovery

- **Already leased:** disconnect the other Pi session, or use a different directory.
- **After a Pi crash:** inspect `.pi-browser.lock` inside the User Data Dir.
  It records the owning PID and hostname.
  Only after confirming that owner has exited, remove that exact file and retry.
  The extension deliberately does not reclaim leases automatically.
- **Chrome running without a Debug Port:** quit that dedicated Chrome window and retry.
  A live Chrome lock is never deleted.
- **Unresponsive leftover tab:** close that Automation Tab manually and retry so a new tab can be created.
- **Invalid Allowlist:** repair its JSON before approving permanently.
  Invalid files grant nothing and are not silently overwritten.

## Commands

`/browser [on|off|status|help]` controls sticky Tool Availability.
Bare `/browser` shows status; `enable` and `disable` alias `on` and `off`.

Off hides Browser Tools from the model without changing Chrome, the Attachment, or Domain Approval.
On restores them.
A missing or invalid availability file defaults to on.
The file is `$PI_CODING_AGENT_DIR/extensions/pi-browser.json`.
Use `pi config` to unload the package itself.

## Domain Approval

On first access to a Registrable Domain, Pi offers:

- **Approve once:** grant access for this Pi session.
- **Approve permanently:** persist the grant to the Allowlist.
- **Deny:** block access to that domain for the rest of this Pi session without persisting a denial.

Approving `example.com` also approves its subdomains, across HTTP/HTTPS and ports.
Private suffixes remain separate: approving `foo.github.io` does not approve `bar.github.io`.
IP addresses and localhost names use their host as the approval scope.
Only HTTP(S) sites and the empty `about:blank` document are accepted.
Without a UI, unapproved domains fail closed rather than silently passing.

The Allowlist is `$PI_CODING_AGENT_DIR/extensions/pi-browser-allowlist.json`:

```json
{
  "version": 1,
  "domains": ["example.com"]
}
```

To revoke a permanent grant, remove its entry and run `/reload` or start a new Pi session.
Configuration writes use exclusive temporary files, atomic replacement, and owner-only permissions on platforms that support POSIX modes.

Clicks, redirects, and script-initiated top-level HTTP(S) navigation cannot leave the approved set.
A blocked hop fails the active tool without prompting for its destination.
Use `browser_navigate` explicitly to request another domain.
The prior approved URL is restored if it changed; an unchanged document is not unnecessarily reloaded.
Spontaneous blocked navigation stays in place.
The final URL is checked before a tool returns.

Interception happens inside Chrome's native network stack for document requests, without fetching or buffering responses through Node.
Subresources keep Chrome's normal caching and networking behavior.
Service workers are bypassed in the Automation Tab while attached so they cannot bypass document interception; other tabs retain their normal behavior.

## Security and privacy

Domain Approval is a grant to act as you, not a network sandbox.
On an approved site, the agent can submit forms, change data, read storage, and run arbitrary JavaScript.
Iframes, popups, subresources, and cross-origin requests made by an approved page are not separately gated.
A local process running as your OS user is outside this protection boundary.

Page text is untrusted data and may contain prompt injection.
Snapshots, screenshots, and evaluation results enter the Pi conversation and may include personal data or tokens.
Use a dedicated browser directory with only the accounts you need, review permanent grants, and redact outputs before sharing.
Report vulnerabilities privately following [SECURITY.md](../../SECURITY.md).

## Development

From the workspace root:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @zenspc/pi-browser check
pnpm --filter @zenspc/pi-browser test
pnpm check
pnpm test
```

Try the working tree without installing it permanently:

```bash
pi -e ./packages/pi-browser/src/index.ts
```

The browser tests require a system Chrome and launch it headlessly against disposable directories.
They exercise real redirects, service workers, cache reuse, stale Refs, cancellation, synchronous infinite-loop recovery, and persistent-tab reuse.
Shared test helpers wait for Chrome to exit before deleting its directory.
They are excluded from the published package.
Browser discovery has unit coverage for Linux, macOS, and Windows; real-browser verification for this refactor was performed on Linux.
