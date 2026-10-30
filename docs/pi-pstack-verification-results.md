# Pi-pstack continuation results

## Outcome

The read-only reviewer acceptance integration is fixed in the bundled guidance and verified with real delegated reviews.
The one-shot forwarding fix is prepared and verified across Pstack and an isolated patched Pi host, but stock Pi 1.4 remains blocked until the upstream host change is adopted.
The complete workflow inventory and safe staged campaign are in [the verification plan](pi-pstack-verification-plan.md).
The exhaustive campaign was not launched.

All live workflow inference in this continuation used only `openai/gpt-6-luna`, including lead sessions and both reviewer children.
No Sol, Codex, other provider, or alternative model was used to make a test succeed.
The prior reports linked in the handoff remain historical evidence, not new Luna-only coverage.

## Repository and isolation

The starting checkout was `master` at `79feb7b`, not the older handoff commit.
It had two pre-existing untracked documents, `docs/new-extension-requirements.md` and the handoff itself; no pre-existing tracked diff was present.
The requirements document was not edited.
The handoff was updated with continuation pointers and the current model restriction.
No commits, PRs, deployments, external messages, real forge writes, or destructive production workflows were performed.

The live artifact root is `/tmp/pi-pstack-fix.K3fVWW`.
The package was loaded from the actual working checkout rather than a flattened package copy.
Temporary Pi settings, credential/model copies, sessions, fixtures, and an isolated host copy lived under that root.
The user's global credentials, settings, model selections, and installed host were not edited.
Temporary `agent/auth.json`, `agent/models.json`, and `agent/models-store.json` were removed after all live runs.
The remaining isolated settings enforce a strict Luna-only subagent scope and do not disable or override worker acceptance globally.
Raw provider-catalog captures were not requested or retained by the new review controller.

## One-shot command forwarding

### Finding and implementation

The source trace established the host ownership gap.
Pi's `AgentSession.sendUserMessage()` returns the prompt promise, but the extension runtime binding and facade discard it and declare `void`.
JSON/print mode disposes after its awaited slash-command handler returns.
The forwarded prompt can still be awaiting input preflight at that point, so merely waiting for an apparently idle agent would race.

Pstack now awaits the send completion in one-shot modes while leaving RPC/TUI acknowledgment behavior asynchronous.
The upstream source patch and its contract are in [the patch note](patches/pi-1.4-awaitable-send-user-message.md) and [the patch](patches/pi-1.4-awaitable-send-user-message.patch).
The patch applies cleanly to the installed source-map generation; its equivalent runtime wrapper changes were exercised in an isolated host copy.
There is no runtime monkey patch or automatic installation in Pstack.
Stock Pi 1.4 still reproduces the defect even with the Pstack-side await, because awaiting its `void` result cannot wait for the detached task.

### Real-surface checks

`node /tmp/pi-pstack-fix.K3fVWW/verify-forwarding.mjs` performed the following checks.

| Scenario | Actual observation | Verdict |
| --- | --- | --- |
| Stock Pi 1.4 JSON `/setup-pstack`, `/pstack status`, `/poteto-mode <task>` | Exit zero, no assistant result, faulty fixture unchanged. | Defect reproduced; unresolved on stock host. |
| Patched host JSON, same command surface | Exactly one expanded user task; actual Luna responses; stop result and settlement before exit. | Passed. |
| Patched host long-lived RPC, same task | Prompt acknowledgment did not time out; exactly one expanded user task; actual Luna stop response and settlement. | Passed. |
| Independent actual CLI checks after each successful task | Numeric order, negatives, duplicates, decimals, and empty arguments all matched exact expected output. | Passed. |

Both successful demos fixed the deliberately faulty default `.sort()` using numeric comparison.
For `node rank.mjs 2 10 1`, the independent post-fix check returned `1 2 10` instead of `1 10 2`.
The task explicitly forbade delegation, installs, commits, PRs, network tools, and writes outside its local demo directory.
It required proportionate playbook use and explicit skips for forbidden/unavailable steps.

The initial all-mode-await experiment passed JSON but caused the RPC client's command-response deadline to expire.
That was an implementation finding, not a broken tool or successful RPC test.
The mode-specific change resolved it in the second run.
The first log remains `/tmp/pi-bg/2116902-bg1.log`; the passing repetition is `/tmp/pi-bg/2116902-bg2.log`.

Evidence includes `stock-events.jsonl`, `one-shot-events.jsonl`, `rpc-events.json`, `forwarding-result.json`, `one-shot-retry/`, `rpc-retry/`, and their corresponding session directories under the artifact root.
The controller independently asserts one expanded user message, normal final response, model identity on every assistant event, settlement, and the five real CLI cases.
`forwarding.test.ts` additionally checks print-mode ownership and busy follow-up parameters deterministically; text print and live busy-session behavior were not exercised.

## Read-only reviewer acceptance

### Implementation

The current pi-subagents package is 0.84.0.
Its bundled worker explicitly declares `acceptanceRole: writer`; limiting tools alone does not change that policy.
The new shared reference, `skills/poteto-mode/references/pi-delegation.md`, prescribes an explicit, reasoned `{level:"none"}` policy only for read-only worker launches.
It uses current direct-call `options` placement and scripted-child field placement, not deprecated `acceptance: false`.
Writer evidence policies and the global worker role remain intact.

Interrogate, How, Why, Reflect, Arena's read-only judge, Swarm's analysis lanes, and maintenance source-wave guidance link the same reference.
The reference also documents native scripted fanout when a named parallel resource cannot carry the required child controls, and supported effective-thinking controls instead of ignored dispatch-level `thinking`.
Sync tooling preserves the reference and regenerates the links so an upstream content sync does not silently erase the fix.

### Live review and independent audit

The new controller used the real `/setup-pstack` RPC picker to configure all selected roles to Luna and both Interrogate seats to Luna in order.
The lead invoked the updated `/skill:interrogate` against the unchanged faulty numeric-sort fixture.
It loaded the shared delegation reference and launched exactly two native, fresh-context, read-only worker reviewers through scripted `runs.all`.
Both returned a concrete numeric-sort finding; the lead delivered the Interrogate synthesis and labeled it same-model sampling.
No child reported runtime execution of the fixture.

| Seat | Run ID | Requested / actual assistant model | Effective thinking | Exit / acceptance |
| --- | --- | --- | --- | --- |
| A | `1ae97aed-2d6d-4342-ab3f-378311ad4ea3` | `openai/gpt-6-luna` / `openai/gpt-6-luna` | low | 0 / not-required |
| B | `fd1a1738-aa75-4060-8ecd-ab0d13481462` | `openai/gpt-6-luna` / `openai/gpt-6-luna` | low | 0 / not-required |

`node /tmp/pi-pstack-fix.K3fVWW/audit-review.mjs` passed independently of the lead's summary.
It checked both exact metadata files and terminal child assistant responses, final stop reasons, requested and actual models, effective low thinking, scoped acceptance reason, explicit fresh context and read-only launch tools, observed child calls, unchanged fixture, and absence of global acceptance-role/policy overrides.
The worker definition still declares writer, and both metadata ledgers retain `async declared writer` as their original inferred policy reason while the explicit read-only policy is confined to those runs.
This demonstrates scoped review acceptance without disabling writer gates globally; it does not claim that a separate live writer-gate failure scenario was exercised.

Two prelaunch driver/model mistakes are retained, not hidden.
The first reply-block workflow call had no visible code block; the next supplied `options.script` together with `workflow:true`, which the runtime correctly rejected.
The final call supplied `options.script` without `workflow`, launched exactly the two expected children, and completed via native notifications.
These were script-shape errors before any child launch, not model-routing or package acceptance failures.
No additional retry reviewers or manual Pi subprocess reviewers were used.

Evidence under the artifact root includes `run-review.mjs`, `setup-selections.json`, `agent/pstack/models.json`, `messages.json`, `lead-result.md`, `review-audit.json`, `rpc-events.jsonl`, and `sessions/subagent-artifacts/<run-id>_meta.json` plus their output/transcript files.
The controller log is `/tmp/pi-bg/2116902-bg3.log`.
The raw review model catalog was not captured.

## Deterministic regressions and toolchains

These checks are distinct from the live model-driven acceptance runs above.

| Check | Result / scope |
| --- | --- |
| New forwarding regression before implementation | Failed on premature command completion, proving the assertion is red-capable. |
| New forwarding regression after implementation | Passed: JSON/print await completion, RPC/TUI acknowledge promptly, exactly one forwarded message, busy follow-up parameters, off does not infer. |
| New delegation/inventory regressions | Passed: scoped acceptance reference, sync preservation/idempotent links, exactly one matrix entry for each skill/playbook/agent. |
| Package tests and package manifest checker | Passed from the correct monorepo layout. |
| Full root `pnpm test` | 529 passed, zero failed or skipped in the recorded full run. |
| Bun `orch` / `watch-pr` tests | 75 passed, zero failed. |
| Nested watcher and statechart typechecks | Passed. |
| Statechart offline suite | 193 passed, 67 skipped, zero failed; skipped prerequisites are explicit in the log, including unavailable TLC. Not live formal-verification coverage. |
| `git diff --check` | Passed. |
| Upstream patch application check | Passed against the recovered exact Pi sources; not an upstream build/full-suite result. |

The combined deterministic/toolchain log is `/tmp/pi-bg/2116902-bg5.log`.
The final root regression repetition after sync-tool changes is `/tmp/pi-bg/2116902-bg6.log`.
One old sync-test assertion expected the previous blanket suffix prohibition; it was updated to assert the supported-control reference and tested again, not left failing.

## Remaining coverage and blockers

- Stock Pi 1.4 one-shot command forwarding needs upstream release/adoption; use direct `/skill:poteto-mode <task>` or long-lived RPC meanwhile.
- The host source patch has not been published, installed globally, or validated with the complete upstream build/test suite.
- TUI interaction, live text-print mode, direct-skill one-shot demo, live busy follow-up, branch/compaction/interruption/resume, failure-seat preservation, scalar writer gates, and all other bundled workflows remain unexercised here unless the plan explicitly cites deterministic or historical coverage.
- Cross-model diversity is not tested and must not be inferred from two Luna reviewers.
- `show-me-your-work` requires a different-family trail reviewer, so full acceptance of that step conflicts with the current Luna-only restriction; the plan marks it blocked rather than silently substituting.
- Statechart live Java/TLC and network-dependent renderer checks were not provisioned or run; ffmpeg is present but that does not prove video acceptance.
- Inspection found the worktree-audit playbook advertises an explicit-base flag while the current script hardcodes `origin/main` and HOME history; the plan requires an isolated synthetic HOME and records alternate-base behavior as an outstanding mismatch, not a verified feature.
- Real GitHub/Origin writes, merges, deployments, recurring schedules, private-history scans, and destructive cleanup remain gated.

The plan covers every bundled entry with prerequisites, role/variant choices, bounded fixtures, observable checks, evidence, effects, teardown, status/blockers, a staged budget, and per-entry completion criteria.
It is not an all-workflows success report.
