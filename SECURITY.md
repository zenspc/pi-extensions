# Security Policy

## Supported versions

This monorepo is pre-1.0.

Security fixes are applied only to the **latest published version** of each package:

- `@zenspc/pi-safety`
- `@zenspc/pi-workflow`
- `@zenspc/pi-devtools`
- `@zenspc/pi-copilot-discovery`

Older published versions are not maintained with backports unless a release note says otherwise.

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public GitHub issue for vulnerabilities, secrets, or token leaks.

Preferred:

1. Use [GitHub Private Vulnerability Reporting](https://github.com/zenspc/pi-extensions/security/advisories/new) when it is enabled for this repository.
2. Otherwise contact the maintainers privately via GitHub: [@dhairyaar](https://github.com/dhairyaar).

Include:

- Affected package name and version
- Impact summary
- Reproduction steps or proof of concept (keep it minimal)
- Whether the issue is already public

We will acknowledge private reports as soon as practical and coordinate disclosure.

## What is out of scope

Some debug surfaces intentionally expose local session or environment data.
That is not treated as a vulnerability by itself.

Examples:

- `/context prompt full` and similar context dumps
- Memory dumps or session inspection output from these extensions

Those features can include local secrets, tokens, or absolute paths from the host machine.
Treat their output as sensitive.
Redact before sharing, and do not file public issues that paste unredacted dumps.

Bugs that allow **unintended** secret exfiltration (for example, leaking credentials into logs without the user requesting a dump) are in scope and should be reported privately.

## Bad published versions

If a published package version is broken or unsafe, ship a fixed version immediately.
Unpublish is limited by npm policy after a short window.
Deprecate the bad version with `npm deprecate @zenspc/<pkg>@<ver> "reason; use @zenspc/<pkg>@X.Y.Z"`.
If a tarball leaked tokens or secrets, rotate credentials and report via the private channel above.

## Non-vulnerabilities

The following are expected product behavior, not security bugs:

- Intentional local context dumps in `@zenspc/pi-devtools` (`prompt full`, expanded prompt view, `memory <substr>`)
- User-disabled safety guard (`~/.pi/agent/safety-guard.json` with `"enabled": false`)
- Upstream Copilot/GitHub outages, rate limits, or policy denials
- Missing models due to tenant entitlements or account configuration
