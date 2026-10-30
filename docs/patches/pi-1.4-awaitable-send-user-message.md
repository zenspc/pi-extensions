# Awaitable extension user-message sends for Pi 1.4

## Ownership and application

The adjacent `.patch` is an upstream Pi source patch, not a patch to pi-pstack or a modification of the user's installed Pi.
It targets `packages/coding-agent/src/core/{agent-session.ts,extensions/loader.ts,extensions/types.ts}` from the source maps shipped with the installed Pi 1.4.0 package.
`git apply --check` passed against those exact recovered sources.
Apply and build it in a separate Pi checkout after reviewing it; no upstream PR, release, global install, or dependency pin was performed here.
The complete upstream repository typecheck/test suite was not available in that recovered three-file fixture and was not claimed to pass.

## Root cause and contract

`AgentSession.sendUserMessage()` already returns a promise for prompt completion.
The extension runtime binding and API facade both discard it, and the exported extension handler types declare `void`.
Print/JSON mode awaits the slash-command handler and then disposes its runtime; it does not own the detached forwarded prompt.
Input handlers and authentication can still be in asynchronous preflight before the agent is marked busy, so an immediate `waitForIdle()` does not solve that ownership gap.

The patch propagates the existing promise through both wrappers and updates both exported types.
It preserves existing error notification behavior by returning the promise after the runtime's existing catch/report handler.
That promise therefore represents completion, not a new rejecting error channel.
An idle-started send resolves when its run finishes; a busy-session follow-up resolves once it is queued, not after that future run completes.
Existing unawaited calls retain their fire-and-forget behavior.

Pstack now awaits that promise in JSON/print modes only.
RPC and TUI retain prompt command acknowledgments rather than blocking until model settlement.
The first experiment awaited in every mode and caused the RPC client's command-response deadline to expire; that failed experiment is retained in the evidence report.
No arbitrary timer, duplicate prompt, private session API, or global host modification is used.

## Verification

`packages/pi-pstack/extensions/pstack/forwarding.test.ts` was red before the Pstack change and is green after it.
It verifies exactly-one forwarding, off behavior, JSON/print completion ownership, busy follow-up parameters, and prompt RPC/TUI acknowledgment with a controllable awaitable host send.
It does not pretend the stock host returns that promise.

The live controller at `/tmp/pi-pstack-fix.K3fVWW/verify-forwarding.mjs` exercised the actual CLI with only `openai/gpt-6-luna`.
Stock Pi 1.4 exited zero without a model result or fixture edit, reproducing the defect.
An isolated copy with the two equivalent runtime JavaScript wrapper changes completed the JSON demo and RPC regression.
Both had exactly one expanded user task, actual Luna assistant replies, normal settlement, and five independently rerun CLI checks.
See `docs/pi-pstack-verification-results.md` for exact logs and limits.
Text print mode, upstream full-suite integration, preflight-error regression, and live busy-session follow-up remain additional upstream acceptance cases.

Until an awaitable host is adopted, stock Pi 1.4 users should use the direct `/skill:poteto-mode <task>` one-shot entry or a long-lived RPC session.
Do not describe the Pstack-only change as fixing stock Pi 1.4 one-shot forwarding.
