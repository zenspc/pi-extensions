# Pi-pstack continuation handoff

## Continuation status

The requested targeted work has been performed with Luna-only live workflow tests.
Read [continuation results](pi-pstack-verification-results.md) for exact passes, failures, evidence paths, and limitations.
Read [the complete workflow verification plan](pi-pstack-verification-plan.md) for the 58-skill, 23-playbook, two-agent inventory, script coverage, safe fixtures, budgets, and remaining campaign.

Read-only worker acceptance now uses a supported scoped policy and passed an actual two-reviewer Interrogate run on stock Pi 1.4.
One-shot forwarding passed JSON and RPC demos with an isolated upstream host patch; stock Pi 1.4 still needs that host change adopted.
The patch and ownership details are in [the upstream patch note](patches/pi-1.4-awaitable-send-user-message.md).
No global host/configuration change or upstream publication was made, and the exhaustive workflow campaign was not launched.

The remainder below is the original reproduction contract and historical handoff, not a claim that continuation changes were absent.

## Original next-session objective

Fix the two observed integration issues, then produce a plan to verify every bundled workflow.
This handoff request did not implement fixes or launch the full workflow-verification campaign.
The user specifically means actual extension verification with demo tasks, not merely unit tests.

## Workspace and boundaries

The repository is `$HOME/Projects/ai-workspace/pi-extensions`.
At handoff it was on `master` at `33f3f2c5b95e8055153e67a0dae60551b3e76f0e`.
The working tree already contained extensive modified and untracked files before this session.
No repository source files were changed during this conversation; all demos, scripts, and reports were created under `/tmp`.
Inspect the current diff and preserve pre-existing changes rather than treating them as this session's implementation.
Load the applicable `AGENTS.md` files and repository domain/agent documentation before editing.

The current user restriction supersedes the historical three-model allowance: use only `openai/gpt-6-luna` for all workflow verification, including leads and delegates.
Historical Luna/Sol and rejected Codex evidence below is retained for diagnosis, not permission to run those other models again.
The current provider/account rejected Codex, so do not silently change provider, credentials, or model to make a test appear successful.
A supported Luna/Sol panel has already completed successfully.
No authorization was given to merge PRs, deploy, send external messages, or exercise destructive production workflows.

## Read the existing evidence first

These artifacts contain the detailed reproduction steps, outputs, run IDs, limitations, and environment, so do not recreate their narrative in a new plan.

| Artifact | Read when |
| --- | --- |
| `/tmp/pi-pstack-test.UWjYvF/RESULTS.md` | Investigating the one-shot command-forwarding failure and the successful live Poteto demo. |
| `/tmp/pi-pstack-test.UWjYvF/one-shot-events.log` | Checking the exact failing one-shot invocation output. |
| `/tmp/pi-pstack-test.UWjYvF/run-demo.mjs` | Reproducing the failing real CLI invocation. |
| `/tmp/pi-pstack-test.UWjYvF/run-rpc-demo.mjs` | Comparing with the successful long-lived RPC invocation. |
| `/tmp/pi-pstack-test.UWjYvF/verify-demo.mjs` and `verify-controls.mjs` | Reusing artifact, transcript, and real command acceptance checks. |
| `/tmp/pi-pstack-models.Wk9Et8/RESULTS.md` | Investigating model routing, read-only reviewer acceptance, thinking controls, and native parallel-launch compatibility. |
| `/tmp/pi-pstack-models.Wk9Et8/supported-lead-result.md` | Inspecting the successful configured Luna/Sol review synthesis and its exact evidence paths. |
| `/tmp/pi-pstack-models.Wk9Et8/model-audit.json` and `audit-models.mjs` | Verifying requested versus actual model replies and distinguishing failed attempts from completed reviews. |
| `/tmp/pi-pstack-models.Wk9Et8/run-model-demo.mjs` | Reusing the actual `/setup-pstack` RPC picker driver and native delegated-workflow verification. |

The earlier report's statement that delegation was not tested applies only to that first demo; the model-routing report covers subsequent real delegated runs.
Temporary authentication and provider-model configuration copies were removed after verification.
Raw model-catalog captures and raw RPC event logs from the model-routing runs were also removed intentionally.
The launchers therefore need a new isolated runtime configuration before another live run; the retained offline evidence audits do not need credentials.
Avoid displaying or retaining secrets when restoring temporary authentication.
The filesystem paths in this handoff use `$HOME` instead of personal home-directory identifiers.

## Fix scope

### 1. One-shot Poteto command forwarding

The observed symptom is activation followed by successful process exit before the forwarded task executes in one-shot JSON mode.
The equivalent long-lived RPC path succeeded.
The underlying cause was not proven, so treat the process-lifetime explanation as a hypothesis rather than an established root cause.
Use the first report and its launchers as the reproduction contract.
Start source tracing around `packages/pi-pstack/extensions/pstack/index.ts`, especially the `poteto-mode` handler, `sendUserMessage`, and relevant Pi command/prompt lifecycle APIs.
Read the installed Pi documentation and implementation before selecting a fix; ownership may span Pstack and the host lifecycle.
The fixed one-shot path should execute the expanded task exactly once and finish only after its actual result is available.
Preserve RPC behavior, hidden-skill expansion, explicit off handling, and persisted mode state.
Add targeted automated regression coverage, but require a real one-shot demo and a real RPC regression run before declaring the issue fixed.

### 2. Read-only reviewer acceptance

The Interrogate workflow's required read-only `worker` reviewers triggered a writer-style acceptance contract in the installed pi-subagents runtime.
The successful demos explicitly disabled that inappropriate contract; no package source fix was made.
Read the model-routing report's “Workflow integration findings” section and the retained failed/successful metadata before choosing the package-level remedy.
Inspect `packages/pi-pstack/skills/interrogate/SKILL.md`, its references, related review workflows, and the installed pi-subagents acceptance API.
Prefer a supported current API and a focused workflow change rather than copying the demo's deprecated shorthand without checking.
Check other bundled read-only `worker` launch sites for the same problem, while preserving evidence gates for real code-writing delegates.
Use a real fresh-context review to prove that a valid review completes without disabling mutation-task safety checks globally.
Account-level Codex access is a separate environmental blocker, not a code-routing defect to disguise with fallback.

The same report also records ignored dispatch-level thinking fields and rejected named-parallel per-task controls.
Evaluate whether bundled workflow instructions need compatible parameter guidance as part of the fix; distinguish package defects from mistakes in the temporary demonstration driver.

## Plan to verify all bundled workflows

Produce an actionable verification plan and coverage matrix after deriving the inventory from the current package manifest, skills, playbooks, bundled agents, and supporting scripts.
Do not treat a successfully loaded skill or one successful Interrogate run as evidence that all workflows execute correctly.
Classify instruction-only principles and communication skills separately from executable workflows, and justify entries that have no standalone runtime scenario.

Each matrix entry should identify the entry command or trigger, relevant variant, prerequisites, model roles, bounded demo fixture, observable acceptance criteria, retained evidence, side effects, cancellation/cleanup, and current status or blocker.
Cover command behavior and state, one-shot/RPC/TUI differences where relevant, scalar and ordered-panel model choices, native delegation, and failure paths without assuming all these dimensions apply identically to every skill.
For model assertions, check child assistant responses and terminal run metadata rather than just launch arguments or registry availability.
Include representative invalid configuration, unavailable model, missing skill/resource, interrupted run, and resume cases where the workflow depends on them.
Define safe local fixtures for workflows involving Git, PRs, schedulers/watchers, external services, renderers, or formal-verification tooling.
Mark real external or destructive actions as gated or blocked instead of running them automatically under this request to plan verification.
Separate deterministic regression checks from genuine model-driven acceptance runs, and record both distinctly.
Propose a bounded execution order, resource/model budget, artifact layout, and per-workflow completion criteria before starting an exhaustive live campaign.
Reference the existing successful demos as reusable coverage rather than repeating them unnecessarily.

## Discovery and execution notes

Use the codebase-memory MCP graph before code discovery, following the repository's instructions.
Refresh project identity and index freshness in the next session instead of assuming the previous generation is current.
The earlier graph lookup located `pstackExtension`, `systemPromptInjection`, `modelChoices`, `pickListRole`, and `formatRoleTable` in the Pstack extension/config files.
Temporary demo fixtures are not indexed repository evidence.

The authoritative Pi docs are available from the installed `@earendil-works/pi-coding-agent` package under the repository's `node_modules`, including `docs/` and `examples/`.
The installed pi-subagents docs are under `$HOME/.pi/agent/npm/node_modules/pi-subagents/docs`.
Read its current execution, acceptance, model-scope, and async-result contracts before adapting the retained launchers.
Keep temporary Pi credentials, settings, sessions, and artifacts isolated from the user's global configuration.
Use background-job completion delivery rather than polling model runs.

An early flattened-package unit-test attempt failed monorepo-relative packaging assumptions.
Its log is `/tmp/pi-bg/1541421-bg1.log`; do not treat that copied-layout failure as proof of a source regression.
Run package regression tests from the correct repository layout when implementing fixes, and still perform the requested real-surface demos.

## Suggested skills

Call the Skill tool for the following skills when available; otherwise load their `SKILL.md` files through the harness's supported skill-loading mechanism.

- `diagnosing-bugs` for root-cause reproduction and diagnosis before fixing command forwarding.
- `pi-docs` for the installed Pi extension, command, SDK, RPC, and lifecycle contracts.
- `pi-subagents` for authorized live delegate tests, acceptance controls, model selection, and retained-run evidence.
- `agent-instructions` before editing workflow skills or other agent-facing guidance.
- `ponytail` for the smallest root-cause fix and reuse of the existing demo drivers.
- `security-and-hardening` when preparing temporary authentication or interacting with third-party services.
- `code-review` if an independent review of the final changes is requested; do not assume this handoff itself requires review fanout.

## Expected next-session deliverables

Implement and verify the two integration fixes, with any remaining ownership or environment blocker disclosed.
Provide the complete bundled-workflow inventory and a safe, evidence-based verification plan.
Report precisely which real scenarios passed, which failed or remain blocked, and what was not exercised.
Do not claim that every bundled workflow works until the planned coverage has actually been executed and checked.
