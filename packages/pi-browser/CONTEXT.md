# pi-browser

A Pi extension that lets the agent drive the user's running Chrome with full automation, gated by per-domain user approval.

## Language

**Attachment**:
The live connection from the extension to Chrome over the DevTools Protocol port.
_Avoid_: Connect, link, bridge

**Automation Tab**:
The single browser tab owned by the extension and reused for all agent activity. User tabs are never touched.
_Avoid_: Working tab, agent tab, target page

**Element Ref**:
A stable short identifier assigned to each interactive element in a snapshot, used by the agent to target clicks and typing.
_Avoid_: Selector, locator, ref id

**Snapshot**:
The accessibility-tree listing of the Automation Tab that the agent reads instead of raw HTML.
_Avoid_: DOM dump, page state

**Domain Approval**:
The user's grant for the agent to act on one site. Offered as Approve Once (this Pi session) or Approve Permanently.
_Avoid_: Permission, consent

**Allowlist**:
The persisted set of domains holding an Approve Permanently grant.
_Avoid_: Trusted sites, whitelist
