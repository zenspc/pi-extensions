# @zenspc/pi-browser

A Pi extension that lets the agent drive a dedicated Chrome with full automation, gated by per-domain approval.

The first tool call launches a headed system Chrome against a User Data Dir the extension owns, default `~/.pi-chrome`.
It never uses the user's daily Chrome data.
The Debug Port is ephemeral and read from that dir.
It never attaches to some other Chrome just because that Chrome has a debug port open.
All agent activity happens in one owned tab, the Automation Tab.
Your other tabs are never touched.
The window stays up when Pi exits.

## Setup

1. Install the extension:

	```bash
	pi install npm:@zenspc/pi-browser
	```

2. Call any browser tool.
	Chrome launches on first use.
	If that Chrome is already running, a later Pi session attaches to it and reuses the Automation Tab.

Override the User Data Dir with `PI_BROWSER_USER_DATA_DIR` (absolute after `~` expansion).
Override the Chrome binary with `PI_BROWSER_CHROME_BIN`.
If that is unset, the extension searches Chrome, then Chromium, then Edge.
See [ADR-0011](../../docs/adr/0011-dedicated-user-data-dir.md).

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Navigate the Automation Tab to a URL and report the page title |
| `browser_snapshot` | Render the tab as a compact accessibility tree with an Element Ref like `[ref=e12]` on every interactive element |
| `browser_click` | Click the element for a Ref taken from the last snapshot |
| `browser_type` | Enter text into the field for a Ref |
| `browser_screenshot` | Capture a full-viewport PNG and return it as an image to the model |
| `browser_evaluate` | Run a JavaScript expression in the page context and return the serialized result |

Refs go stale when the page changes.
After navigation or a click that alters the layout, take a new `browser_snapshot` before acting again.
Acting on a stale or unknown Ref returns an error that says so.

Every tool targets the Automation Tab and every tool passes through the Domain Approval gate below.

## Domain Approval

The agent cannot touch a site until you approve it.
On first access to a domain, Pi prompts you with three choices:

- **Approve once** holds for the rest of the Pi session.
- **Approve permanently** writes the domain to the Allowlist and never prompts again.
- **Deny** fails the call and navigates nothing. The denial is not remembered, so the next call prompts again.

Approval covers the whole registrable domain: approving `example.com` also approves `app.example.com`.

The Allowlist lives at `$PI_CODING_AGENT_DIR/extensions/pi-browser-allowlist.json`, by default `~/.pi/agent/extensions/pi-browser-allowlist.json`.
Delete a line there to revoke a permanent grant.

When no UI is available to prompt (headless runs), unapproved domains fail closed with instructions instead of silently passing.

## Security notes

- The agent acts as you. On an approved domain, a tool call can do anything you could do in that tab while logged in.
- `browser_evaluate` runs arbitrary JavaScript in the page. It can read everything the page can read, including cookies and storage for approved domains.
- Snapshots and screenshots capture page content, which can include personal data or tokens. Treat their output as sensitive and redact before sharing, per [SECURITY.md](../../SECURITY.md).
- Permanent approvals outlive the session by design. Review the Allowlist file occasionally and prune domains you no longer automate.

Report vulnerabilities privately following [SECURITY.md](../../SECURITY.md).
Do not open a public issue.

## Development

```bash
pnpm install
pnpm check
pnpm test
```

The test suite launches Chrome against a throwaway User Data Dir.
Set `PI_BROWSER_CHROME_BIN` to override the Chrome binary.
