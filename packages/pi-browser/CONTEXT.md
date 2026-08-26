# pi-browser

A Pi extension that lets the agent drive a dedicated Chrome with full automation, gated by per-domain user approval.

## Language

**Attachment**:
The live connection from the extension to the dedicated Chrome over the DevTools Protocol.
_Avoid_: Connect, link, bridge

**Debug Port**:
The remote debugging port the dedicated Chrome opened for this User Data Dir. Discovered from the dir, not a fixed number.
_Avoid_: CDP endpoint, devtools socket, 9222

**Automation Tab**:
The single browser tab owned by the extension and reused for all agent activity. Its rest state is an empty document, not a site. User tabs are never touched.
_Avoid_: Working tab, agent tab, target page

**Element Ref**:
A stable short identifier assigned to each interactive element in a snapshot, used by the agent to target clicks and typing.
_Avoid_: Selector, locator, ref id

**Snapshot**:
The accessibility-tree listing of the Automation Tab that the agent reads instead of raw HTML.
_Avoid_: DOM dump, page state

**Registrable Domain**:
The site-root hostname a Domain Approval covers, including all subdomains of that root.
_Avoid_: Origin, hostname, eTLD+1

**Domain Approval**:
The user's grant that the agent may act as the user on one Registrable Domain, for this Pi session or persisted on the Allowlist. It is not a sandbox.
_Avoid_: Permission, consent, sandbox

**Allowlist**:
The persisted set of Registrable Domains holding an Approve Permanently grant.
_Avoid_: Trusted sites, whitelist

**Session Deny**:
A Domain Approval refusal remembered for the rest of this Pi session and not written to the Allowlist.
_Avoid_: Ban, blocklist, permanent deny

**User Data Dir**:
The Chrome data folder the extension owns and reuses. It is not the user's daily Chrome data.
_Avoid_: Profile, chrome profile, persistent profile
