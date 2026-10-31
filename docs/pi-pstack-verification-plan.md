# Pi-pstack workflow verification plan

## Scope and evidence standard

This is a bounded execution plan, not a claim that all workflows work.
The inventory comes from `packages/pi-pstack/package.json`, all 58 bundled `skills/*/SKILL.md` entries, all 23 Poteto Mode playbooks, both bundled agents, and the script entry points below.
The workspace manifest exposes the same skill and agent directories.
Only `how`, `why`, `unslop`, and `typescript-best-practices` are discoverable skills; hidden skills still have `/skill:<name>` entry points.
A deterministic inventory test in `packages/pi-pstack/scripts/delegation.test.mjs` rejects missing or duplicate skill, playbook, or agent matrix rows.

Use only `openai/gpt-6-luna` for the lead and every delegate in this campaign.
This supersedes the older handoff's three-model allowance.
Repeated Luna seats test ordered same-model sampling, not cross-model diversity.
Different-model execution is deliberately not covered under this restriction.
No provider change, credential change, model substitution, or paid fast mode is permitted to rescue a failed seat.
An unavailable-model negative test uses a deliberately invalid selector and must fail before inference, without attempting another real model.

The initial graph generation was `2026-10-30T13:11:44Z` for `/home/tyz3n/Projects/ai-workspace/pi-extensions`, ready and watched.
Targeted extension paths had no recorded coverage issue.
Statechart corpus CFG and Mermaid files have recorded parser gaps; the inventory below uses filesystem enumeration and skill/tool manifests, not a claim of exhaustive graph understanding of those files.
Read the relevant raw corpus files before implementing or claiming a new formal test.
Refresh graph identity and coverage before each later code investigation.

Read [the continuation results](pi-pstack-verification-results.md) for this session's exact passes and limitations.
Reuse the earlier evidence at `/tmp/pi-pstack-test.UWjYvF/RESULTS.md` and `/tmp/pi-pstack-models.Wk9Et8/RESULTS.md` rather than repeating their demos as fresh coverage.
Those historical runs used other models and do not count as new Luna-only checks.
The first report's absence of delegation coverage was superseded by the second report.

## Completion criteria

A runtime scenario is complete only when its entry surface was actually driven, its observable checks passed, every expected child is terminal, and the retained evidence was independently checked.
Loading a skill, accepting a command, launching a child, or finding a model in the registry is not completion.
For every assistant reply, inspect its actual `provider` and `model`; for children, additionally inspect terminal run metadata, exit code, acceptance policy/status, tools, effective thinking level, and artifact/session paths.
Keep requested and actual selectors separate.
A failed seat is not consensus and does not erase a completed seat.

Instruction-only and communication entries use contextual evaluations rather than standalone process smoke tests.
For them, retain the input, response, rubric, evaluator's observations, and a statement that no runtime workflow was exercised.
Every entry remains planned or blocked until that evidence exists.
`show-me-your-work` currently requires a different model family for its final trail review, so that step and full workflows requiring it remain blocked under Luna-only testing unless the operator explicitly scopes that criterion out.
Do not substitute a second Luna sample and call that different-family requirement satisfied.
A sandboxed forge or scheduler scenario is only local integration coverage, never evidence of a real merge or unattended production operation.

## Common profiles

Each matrix row inherits its profile's prerequisites, artifacts, side effects, and cancellation/cleanup contract.
Row-specific additions override those defaults.
All paths are under a newly allocated task-owned artifact root, never the user's home configuration or this working checkout.
All parent sessions explicitly select Luna, disable unrelated extensions/context, and use isolated settings, auth, model configuration, sessions, and temporary directories.
Copy credentials privately with mode 0600, never print them, never capture raw provider catalog/header payloads, and remove temporary auth/model copies in controller cleanup even on failure.
A strict pi-subagents model scope allows only `openai/gpt-6-luna`; pin writer/reviewer/watchdog roles to Luna when those roles are used.

| Profile | Prerequisites and model roles | Evidence retained | Effects and cancellation/cleanup |
| --- | --- | --- | --- |
| R | Local Node CLI fixture; one Luna lead; JSON or long-lived RPC. | Command argv without secrets, JSONL/session, final response, exact CLI stdout/stderr, initial/final fixture hashes. | Read-only source; session/artifact writes only. Abort active run, await settlement, close stdin/dispose; retain evidence. |
| W | R plus a disposable writable fixture; one writer per cwd. Explicitly forbid commits, PRs, installs, and network unless the row says otherwise. | R plus before/after diff, failing reproduction, independent passing checks. | Edits only inside fixture. On interrupt checkpoint changed files/checks before stopping; remove only owned processes and directories after evidence audit. |
| D | R or W plus installed pi-subagents and explicit fanout authorization. Exact task-scoped cwd/ref and fresh briefs; configured roles listed per row. | Parent and each child session, run IDs, metadata, native completion receipts, saved output mapping, requested/actual model audit. | Read-only workers use the scoped acceptance object in `pi-delegation.md`; writers retain evidence gates. Stop exact created run IDs, await terminal status, preserve partial diffs; remove only owned worktrees. Never poll/sleep for ordinary children. |
| H | R plus two synthetic, workspace-matching Pi JSONL sessions with known branches, timestamps, and irrelevant decoys. | Scoped transcript manifest, selected branch/entry IDs, cited excerpts, input/output hashes. | No global history scan or external messages. Close the session; retain synthetic history and audit. |
| G | W/D plus a fresh local Git repo, local bare remote, and an explicit PATH-injected fake `gh`/Origin CLI backed by recorded JSON. | Git refs/worktree list before/after, forge call ledger, fixture state transitions, watcher receipts. | Local branches/worktrees only. Real PR creation, push to a real remote, merging, deploys, and simulator deletion are GATED. Cancel only created watcher/run IDs; preserve dirty worktrees; cleanup plan first. |
| V | W plus a small localhost UI, pinned viewport, and the required browser/renderer executable. | Browser readings and passing expect steps, screenshots, compared frames or rendered video, ownership/port receipt. | Start only fixture servers and renderers. Stop exact owned jobs and remove temporary renders after evidence capture. No publishing or external uploads. |
| F | W plus the selected verifier already installed and versioned; bounded local model/harness and a matching real implementation. | Tool/version/command, model/config/view, bounds, stdout, counterexample, replay against actual code. | Scratch files only. Missing Java/TLC/mise or required renderer is a blocker; first-run downloads require a separate approved setup step. Cancel the exact verifier process. |
| C | A fixed local prose/code/conversation fixture and Luna lead; delegation only if explicitly prescribed by that row. | Input, output, preservation/style rubric, direct human-readable comparison; tool-call log proving no unintended actions. | No runtime process requirement. Writes only when explicitly editing a fixture; no global skill edits or messages. |
| L | W/H plus a disposable `.pi/skills` target, bounded source app, and predeclared scope. | Generated skill, links/scripts, runnable doctor and drive receipts, mutation/drift proof, target diff. | Writes only inside the chosen local skill directory unless product editing is explicitly part of the fixture. Never install into global skills. |
| S | G/R plus verified native/background event delivery and one finite local event source. | Arm receipt, exactly one completion delivery, stop predicate, cancellation receipt, resume command. | No recurring scheduler or real PR watcher starts automatically. Set a short outer deadline, stop only the created source, verify nothing remains running. |

`R`, `W`, and `D` do not imply that TUI coverage is necessary for every skill.
TUI differences primarily belong to command pickers, completions, status widgets, cancellation, and editor interaction.
Other workflows run first through RPC; repeat JSON only when their entry/lifetime differs.

## Command and state matrix

| Entry / variant | Profile, prerequisite, roles | Bounded fixture and observable acceptance | Status |
| --- | --- | --- | --- |
| `/setup-pstack`, noninteractive defaults | R; isolated missing config; lead selected but no inference expected. | Command writes valid inherited roles once; rerun preserves the file and adds no assistant turn. | Historical pass; fresh Luna controller also exercises default setup. |
| `/setup-pstack`, RPC picker, scalar and ordered panel | R/D; one available Luna selector. | Drive every role; choose scalar Luna, ordered panel `[inherit-parent, openai/gpt-6-luna, auto]`, duplicate seats, cancel first/later role. Compare persisted ordering and unchanged roles; no inference from picker itself. Then run the selected scalar and each panel seat, checking actual replies. | Two explicit Luna Interrogate seats exercised; mixed aliases, every scalar, and cancellation planned. |
| `/setup-pstack`, TUI | R/V; real terminal/PTY driver, not a browser substitute. | Navigate/select/cancel picker, tab-complete commands, inspect status widget and saved selections. Retain PTY transcript. | Planned; no TUI verification claimed. |
| `/pstack on`, `off`, `status`, aliases and invalid args | R; missing/valid/partial/malformed/unreadable config. | Verify state/report/path; no assistant turns; status never rewrites invalid config or exposes raw private content. Off hides only this package's catalog, while explicit hidden skill still expands; on restores catalog next run. | Deterministic coverage and historical controls; live failure variants planned. |
| `/poteto-mode <task>`, JSON/print | W; awaitable-send host patch required for command form on Pi 1.4. | Numeric-sort CLI, exactly one expanded user task, actual Luna reply, final settlement before exit, independent negatives/duplicates/decimals/empty checks. Text print mode must emit final result, not only activation. | JSON passed on isolated patched host; stock 1.4 blocked; text print planned. |
| `/poteto-mode <task>`, RPC | W; long-lived controller subscribes before command. | Same CLI; prompt acknowledgment remains prompt, native settlement follows; no RPC timeout or duplicate execution. | Passed on isolated patched host; historical stock RPC pass. |
| `/poteto-mode`, bare / off / disable / stop | R; loaded full package. | Bare command expands skill once; exact off aliases disable without inference; task text starting with these words still forwards. | Deterministic coverage; live bare/aliases planned. |
| `/skill:poteto-mode`, hidden expansion | W; stock host may use this direct entry without forwarding. | Same bounded CLI task; expanded skill and task appear once; mode persists. Missing skill must error without sending literal slash text to a model. | Deterministic coverage; direct-entry live scenario planned. |
| Mode persistence / branch / compaction / interruption | R/H; persisted session with enabled and off branches. | Resume on/off, navigate branches, compact then issue rigorous task; current branch decides mode and absolute skill recovery pointer. Abort a task, checkpoint, resume without duplicate edit. | Deterministic session coverage; live branch/compaction/interruption planned. |
| Bad resource/model/config paths | R/D; deliberately absent skill, malformed config, invalid model selector. | Exact error, no fallback inference, no overwritten config, no partial child reported complete. Repair only isolated config and retry once. | Deterministic config/resource checks; live invalid-model/launch failure planned. |

## Skill matrix

All skill triggers in this table are `/skill:<name>`; the ID's name supplies `<name>`.
Natural-language triggers are additionally tested for the four discoverable skills using their current descriptions, with positive and near-miss prompts.
Profiles specify retained evidence, side effects, and cleanup for every row.

| Inventory ID | Variant, profile, roles | Fixture and observable acceptance | Status |
| --- | --- | --- | --- |
| `skill:poteto-mode` | W; lead and optional playbook writer. | Command/state matrix above plus routing to the matching playbook, explicit forbidden-step skips, no second top-level playbook in a delegate. | Numeric bug demo passed; other playbooks below planned. |
| `skill:setup-pstack` | R; lead. | Invoke skill body and reach the real command; missing-command fallback writes only valid isolated role JSON, preserves panel order. | Command path exercised; skill fallback planned. |
| `skill:poteto-help` | C; lead. | Ask for command/skill help; links and names match installed package, no imaginary Pi scheduler or universal store. | Planned. |
| `skill:how` | R/D; how explorer / how explainer. | Simple two-module sort CLI then complex parser pipeline; one explainer for simple case, 2-4 angle explorers plus synthesis for complex; cited flow correct and fixture unchanged. | Planned. |
| `skill:why` | H/G/D; why investigators / why synthesizer. | Local Git history with known rationale and fake forge; only explicitly provided read-only evidence tools. All seven evidence categories accounted for, missing MCPs stated, facts/inference separated. | Planned; real private MCP sources gated. |
| `skill:teach` | C/D; how and why roles. | Same two-module fixture/history; actual how/why outputs combined, confidence language preserved, no edits. | Planned. |
| `skill:interrogate` | W/D; ordered interrogate adversaries, isolated repro worktrees. | Faulty sort CLI; adversaries run repros without fixing application code, lead reruns every reported command and keeps only intent-breaking failures. Include duplicate-root-cause, unproven-finding, and failed-seat variants; no false diversity. | Earlier read-only review result is historical; run-proven workflow from 0.15.36 needs a fresh live evaluation. |
| `skill:arena` | W/D; arena runners / cross-judge pool. | Two candidate parsers with separate output directories, 3-6 criterion rubric, read-only different-family judge after candidates stop, selected base plus justified graft, independent CLI checks. Include candidate dropout, rejected selector, and no eligible judge; inherited or same-family seats never judge. | Planned; default inherited pool must skip the judge. |
| `skill:architect` | W/D; architect runners and how/why as applicable. | Greenfield tiny typed parser; two distinct sketches through Arena, rationale and caller usage, fill-in passes behavior checks. Repeat opt-in checkpoint and deliberately invalidated sketch/scrap. | Planned. |
| `skill:swarm` | D/G; swarm workers. | Two read-only angles, then two writers on separate clean fixture worktrees; drain all terminal results and report partial failure honestly. | Planned. |
| `skill:reflect` | H/D/L; reflect tooling / judgment-divergent-synthesizer. | Synthetic transcript containing one reusable correction and one one-off; three reviewers plus synthesizer cite evidence, structural candidates backlogged, no skill edits before explicit fixture approval. | Planned. |
| `skill:recall` | H/D; bounded history investigators. | Two supplied workspace sessions plus decoy, actual mtimes and topics; exclude current/unrelated chats and return scoped goal/decision/open-work brief with citations. | Planned; global/private history gated. |
| `skill:automate-me` | H/L/C; judgment/prose, authoring as needed. | Supplied synthetic preferences and existing local mode skill; new/update/fresh-evidence branches produce only requested local skill and preserve hard safety limits. | Planned; global installation gated. |
| `skill:figure-it-out` | W/D; task-specific writers. | Two-file migration lacking an exact playbook; observable goal, designed phases before edits, hypothesis/rejection trail, real acceptance checks. | Planned. |
| `skill:show-me-your-work` | W/H/D; lead and required different-family trail reviewer. | Record two decisions, one rejected hypothesis, adversarial TSV cells; one canonical log, evidence paths exist, transcript audit catches and supersedes a fabricated claim. | Local logging/audit planned; full workflow blocked because its different-family review conflicts with Luna-only testing. |
| `skill:blast-radius` | R/W; lead. | Tiny serializer with an overlooked downstream numeric consumer; identify caller outside diff and run the counterexample on real code, not just a writeup. | Planned. |
| `skill:correct` | W/H; lead. | Synthetic repeated null/variant mistakes; choose structural fix before prose, demonstrate guard red on actual old mistake and green after fix. | Planned. |
| `skill:tdd` | W; lead. | Sort regression with cheap local seam, red before change and green after; impractical-test variant uses honest direct verification rather than brittle mocks. | Planned; implementation regression here is not a skill invocation. |
| `skill:deslop` | G/W; lead. | Small branch diff with redundant scaffolding and intentional behavior; remove only introduced slop, preserve behavior and unrelated changes. | Planned. |
| `skill:no-comments` | W/D; comment-sicko and parent fixer. | Seed narration, license, real foreign-system caveat, and public API docs; report-only child flags exact scoped symbols and legitimate skips; parent audits and fixes accepted findings, rejects scope escapes, and honors the constraint-encoding approval gate. | Planned. |
| `skill:create-verification-skill` | L/W; lead. | Tiny CLI with two features; generated local skill includes executable doctor, launch/drive/cleanup and feature map; independently rerun both behaviors. | Planned. |
| `skill:maintain-verification-skill` | L/D; one reader per feature, lead drives. | Generated fixture skill with one deliberate drift; source wave covers all files, lead drives each feature, fixes only owned skill dir, reruns corrected harness. Exercise clean/changed/blocked without real PR. | Planned. |
| `skill:create-formal-verification-skill` | L/F; lead. | Bounded retry/counter implementation with known invariant violation; generated local verification skill reproduces counterexample against real code and states proof bounds. | Blocked until selected verifier is provisioned. |
| `skill:maintain-formal-verification-skill` | L/F/G; lead. | Commit changes verified transition while model still passes; detect stale model, update it, classify model drift vs product bug, rerun without weakening invariant. | Blocked on formal fixture/tool setup. |
| `skill:statechart` | F; lead. | Small counter and guarded login models: flat/hierarchical/parallel view; hold/break/deadlock; >500-state bounded chart behavior and unchecked-rule report. Replay bug path on actual implementation. | Blocked on Java/TLC/mise and requested Pele rendering; offline tests are separate. |
| `skill:ketchup` | H/C; lead. | Conversation with two user checkpoints and an intervening tool wake; summarize only since correct user message, verify numbers and pending calls, no code/jobs/messages. | Planned. |
| `skill:ketchup-video` | H/V/C; lead. | Same conversation plus real fixture screenshots; silent landscape video, one point/slide, frame inspection and minimum word hold; renderer failure returns honest text fallback. | Planned; ffmpeg present, renderer recipe still needs provisioning. |
| `skill:bro` | C; lead; contextual communication. | Rewrite a jargon-heavy previous reply, preserve decisions and caveats, no unrelated task or tools. No standalone runtime scenario because it transforms conversation text. | Planned contextual evaluation. |
| `skill:in-your-own-words` | C; lead; contextual communication. | Restate a supplied goal with constraints, distinguish interpretation from facts, do not implement the task. No standalone process. | Planned contextual evaluation. |
| `skill:sharpen` | C; lead; contextual prompt transformation. | Rewrite shallow parser task after naming expert method/raw evidence/external criterion; deeper validation, no added product scope. No standalone process. | Planned contextual evaluation. |
| `skill:unslop` | C; lead; contextual prose editing. | Fixed paragraph containing representative numbered anti-patterns; remove patterns while preserving technical meaning and intended tone. No standalone workflow process. | Planned contextual evaluation. |
| `skill:technical-writing` | C; lead; contextual writing standard. | Mixed tutorial/reference instructions; identify Diataxis purpose, simplify language, preserve commands/claims and useful variation. No standalone runtime. | Planned contextual evaluation. |
| `skill:typescript-best-practices` | C/W; lead; contextual coding guidance. | Small invalid optional-field union and unsafe boundary cast; apply type-system principle, compile valid callers, reject impossible variants. Not a separate orchestrator. | Planned contextual evaluation. |
| `skill:benchmark-checklist` | C/W; lead; contextual measurement rubric. | One real bounded CPU benchmark plus misleading cached/no-op variant; explain limiter/work count/errors/repeats before claiming a speedup; ballpark labeled as one run. Not a standalone runtime workflow. | Planned contextual evaluation. |

### Instruction-only principles

These 24 entries guide another task rather than launching their own workflow.
Load each through `/skill:<name>` in the named contextual fixture, retain a rubric and observable decision/diff, and do not claim a standalone workflow passed.
Use C/W unless a row names D or G; all model roles are the Luna lead and only the explicitly authorized delegates of that fixture.

| Inventory ID | Contextual fixture / observable criterion | Status |
| --- | --- | --- |
| `skill:principle-attack-the-premise` | Two fixes based on the same false assumption; test that premise before a third patch. | Planned. |
| `skill:principle-boundary-discipline` | Malformed CLI JSON; validation at input boundary, not repeated inside trusted helpers. | Planned. |
| `skill:principle-build-the-lever` | Repeated mechanical edits; reusable check/codemod proves the transformation. | Planned. |
| `skill:principle-encode-lessons-in-structure` | Repeated unsafe variant; compiler/lint/test prevents actual old mistake, not another prose rule. | Planned. |
| `skill:principle-exhaust-the-design-space` | Arena fixture produces two structurally distinct candidates and compares them before picking. | Planned with D. |
| `skill:principle-experience-first` | Local UI fixture chooses user-visible clarity over a convenient internal shortcut; behavior check confirms it. | Planned with V. |
| `skill:principle-explain-the-number` | Benchmark fixture exposes cached/no-op work before quoting a speedup. | Planned. |
| `skill:principle-fix-root-causes` | Shared faulty comparator with two callers; fix shared cause and check both real callers. | Planned; historical bug demo is reusable context only. |
| `skill:principle-foundational-thinking` | Typed stateful fixture defines model/data shape before implementation. | Planned. |
| `skill:principle-guard-the-context-window` | Bounded multi-file review keeps exact evidence pointers and compact synthesis without losing required findings. | Planned with D. |
| `skill:principle-laziness-protocol` | Existing utility already solves task; reuse or delete redundant layer, same behavior checks. | Planned. |
| `skill:principle-make-operations-idempotent` | Retry local config operation twice; same state and no duplicate record. | Planned. |
| `skill:principle-migrate-callers-then-delete-legacy-apis` | Two callers migrate in one wave; old API removed and compile/behavior checks pass. | Planned. |
| `skill:principle-minimize-reader-load` | One-caller forwarding layer plus hidden globals; reduce indirections/state without changing outputs. | Planned. |
| `skill:principle-model-the-domain` | State machine fixture rejects impossible combinations structurally. | Planned. |
| `skill:principle-never-block-on-the-human` | Reversible local choice proceeds with stated assumption; destructive action still remains gated. | Planned. |
| `skill:principle-outcome-oriented-execution` | Small migration finishes target architecture at verified phase boundaries without persistent temporary compatibility layer. | Planned. |
| `skill:principle-prove-it-works` | A plausible success summary contradicts actual CLI output; reject the claim and check the artifact directly. | Planned; demo verifiers exemplify the check, not a separate invocation. |
| `skill:principle-redesign-from-first-principles` | Add new state constraint; coherent redesign rather than another special-case guard. | Planned. |
| `skill:principle-separate-before-serializing-shared-state` | Two writers get separate worktrees/output paths, never a shared mutable file. | Planned with D/G. |
| `skill:principle-sequence-verifiable-units` | Two dependent changes with an injected first-step failure; do not advance until its check passes. | Planned. |
| `skill:principle-subtract-before-you-add` | Remove dead shape before adding a feature; retain separate before/after evidence. | Planned. |
| `skill:principle-test-behavior-not-implementation` | Test survives helper extraction but fails a user-visible regression. | Planned. |
| `skill:principle-type-system-discipline` | Brand distinct IDs and exhaust variants; invalid assignments fail typecheck, valid fixture runs. | Planned. |

## Poteto Mode playbook matrix

Trigger `/poteto-mode <bounded task matching the row>` and verify that the corresponding `skills/poteto-mode/playbooks/<name>.md` was actually read.
The root owns the playbook; any delegated step uses the prescribed agent and consolidated fresh brief.
Use Luna for every role, including feature/refactoring, bug-fix, perf-issue, hillclimb, hardest tasks, judgment/prose, and any workflow role routed by the playbook.
The artifact and cleanup contracts come from the listed profiles.
Forbidden external steps must be recorded skipped/gated with a reason, not silently treated as completed.

| Inventory ID | Profile / fixture and required variant | Observable acceptance / blocker | Status |
| --- | --- | --- | --- |
| `playbook:investigation` | R/D; ask how two CLI modules interact. | Cited explanation/recommendation, no edits, no false mutation throughput metric. | Planned. |
| `playbook:bug-fix` | W; faulty numeric-sort CLI. | Real repro before edit, minimal comparator fix, five independent cases, accurate skipped PR/delegation steps. | Luna one-shot/RPC demos passed with explicit bounded overrides. |
| `playbook:perf-issue` | W; finite slow lookup CLI, known workload. | Measured baseline, bottleneck evidence, same-work before/after, correctness unchanged. | Planned. |
| `playbook:hillclimb` | W/G; deterministic scored parser workload. | At most two hypotheses and one accepted win, rejected trial retained, one local commit per accepted win only when fixture permits. | Planned; no real publishing. |
| `playbook:runtime-forensics` | R/W; local process with bounded idle spin. | Instrument live symptom, quantify it, cited diagnosis; do not implement unrequested fix. | Planned. |
| `playbook:trace-forensics` | R; captured fixture CPU profile with known hot loop. | Diagnose from artifact, separate observations/hypotheses, no invented live measurement. | Planned. |
| `playbook:feature` | W; add descending flag to local sort CLI. | Named data shape, behavior tests, consumer/maintainer summary; no PR under bounded grant. | Planned. |
| `playbook:refactoring` | W; extract numeric parser with two callers. | Same exact outputs before/after, migrated callers, old layer deleted. | Planned. |
| `playbook:prototype` | W/V; throwaway fixture with two visual arrangements or state shapes. | Empirical design decision and retained comparison, prototype not promoted as production code. | Planned. |
| `playbook:visual-parity` | V; two localhost renderings with seeded spacing drift. | Fixed viewport reference captured first, actual screenshots compared and failing expectation corrected; no screenshot-free parity claim. | Planned. |
| `playbook:authoring-a-skill` | L; local skill with one exact-format instruction. | Draft/test/iterate and near-miss trigger evaluation, generated files valid, no global install. | Planned. |
| `playbook:eval` | C/L; two skill variants and paired fixed prompts. | Recorded behavior rubric and both outputs, no promotion on mere load or a fabricated score. | Planned. |
| `playbook:babysit` | G/S; fake forge changes from pending to ready, plus blocker/comment/conflict variants. | Active forge verdict governs; malicious review text treated as data; native wake delivered once and watcher rearmed only after state changes. | Local simulation planned; real PR actions gated. |
| `playbook:shipping` | G/S/D; two local fixture branches and fake green checks. | Independent per-PR verdict at exact SHA; only contiguous verified prefix eligible; stale/moved SHA blocks landing. | Real merges/pushes gated; local simulation planned. |
| `playbook:autonomous-run` | W/S; bounded two-item task with finite stop predicate. | Trail, verified event-delivery or honest checkpoint fallback, stop at predicate and teardown owned process. | Planned; no recurring jobs. |
| `playbook:orchestrate` | G/D/S; two tiny units, native Pi tools and task-scoped artifacts. | Coordinator does not write application code, one PR owner/worktree, complete kickoffs, independent current-head verifier, live forge state and terminal receipts. Verify wake delivery or checkpoint external waits; pause safely without coordination scripts or polling loops. | Local simulation planned; standing program gated. |
| `playbook:autopilot-full` | G/D/S; two independent local branch tasks. | Owner per task, root verdict before simulated landing, one failed item does not count merged. | Real queue/merges gated; local simulation planned. |
| `playbook:autopilot-stack` | G/D/S; two dependent local branches. | Linear reviewed stack, exact base/SHA chain, independent verdicts, no merge when operator must land. | Local simulation planned; real forge writes gated. |
| `playbook:session-pickup` | H/G; persisted paused fixture session and dirty local branch. | Verify session/cwd/branch, inspect artifacts and changes, resume next accepted step without losing directives. | Planned. |
| `playbook:pause-safely` | W/H/S; pause after first edit and before second step. | Checkpoint changed files/tests/run/process states, stop exact watcher, fresh pickup reproduces state and completes once. | Planned. |
| `playbook:multi-phase-plan` | L/G; two-phase local parser migration. | Runnable per-unit boot/verify recipes, independent verdict/merge gates, `check-plan.mjs` accepts skeleton and rejects missing requirements. | Skeleton deterministic checks exist; model-driven plan scenario planned. |
| `playbook:worktree-cleanup` | G; disposable repo with clean merged, dirty, and open-PR fixture worktrees. | Audit categorizes correctly, dirty/open paths held, reviewed cleanup plan before any owned-path deletion; no simulator actions. | Audit/local simulation planned; real deletions gated. |
| `playbook:opening-a-pr` | G; local branch, fake `gh` and Origin variants. | Correct base/title/body/evidence and scoped diff; fake call ledger only; unsupported forge reported honestly. | Local simulation planned; real PR creation gated. |

## Bundled agent matrix

| Inventory ID | Entry / profile / roles | Fixture and acceptance | Status |
| --- | --- | --- | --- |
| `agent:poteto-agent` | Native `subagent({agent:"poteto-agent", ...})`; W/D; Luna, explicit writer evidence policy. | Small comparator edit with absolute skill/principle pointers; reads full hidden skill, follows assigned step without launching another playbook, returns diff/checks/risks. Missing-skill and unauthorized-MCP negative cases stop honestly. | Planned. |
| `agent:comment-sicko` | `no-comments` native delegate; R/D; Luna, restricted read/search tools. | Scoped mixed-comment fixture; exact opening, report-only flags and keep exceptions, no application edits. Inspect actual tool access because the definition's bash capability is not a filesystem sandbox. | Planned. |

## Supporting script matrix

Public wrappers and their implementation modules share one entry scenario; private modules are covered by their entry point and deterministic tests, not invented standalone workflows.
Top-level `packages/pi-pstack/scripts/*` are development tooling, not published runtime resources under the package `files` allowlist.
Do not install or download toolchains as an unnoticed side effect of verification.

| Entry / implementation family | Profile and bounded checks | Evidence / status |
| --- | --- | --- |
| `skills/poteto-mode/scripts/check-plan.mjs` | R; bundled skeleton and invalid missing-headings/fenced-code fixtures; assert exact exit/status diagnostics. | Deterministic `check-plan.test.mjs`; keep separate from model-written plan acceptance. |
| `skills/poteto-mode/scripts/watch-pr/watch-pr` and CLI/policy/GitHub/render modules | G/S; fake `gh` PATH and recorded pending/ready/blocked/queued-stack states; check status-only vs finite watcher modes, command error, cancellation. | `bun test watch-pr` plus exact watcher process/delivery receipts; real GitHub coverage gated. Origin remains a separate playbook path, not watcher support. |
| `skills/poteto-mode/scripts/bootstrap.ts` | W; copied script directory with fake package-manager executable and frozen lockfile. | Missing/stale/fresh dependency-stamp branches and failure/no-restart checks planned; no install into checkout. |
| `skills/poteto-mode/scripts/worktree-audit.sh` | G/H; local bare remote with `origin/main`, fake forge, isolated HOME containing only synthetic transcripts. | Categories, fetched refs, unchanged worktrees, no private-history scan or removals. Current script hardcodes `origin/main` and HOME history, while the playbook advertises `-b`; alternate-base/scoped-history behavior is a known unverified mismatch, not supported coverage. |
| `skills/show-me-your-work/scripts/log.sh` | W; temporary TSV, repeated append and adversarial tabs/newlines/formula prefixes. | One header, six columns, sanitized cells, original evidence retained; entry scenario planned. |
| `skills/statechart/scripts/statechart` / `statechart.ts`, run/worker/pipeline, frontends/passes/backends | F; installed verifier, bounded counter/login corpus including bad config/view, missing executable, interrupted verifier, state/rule limits. | Offline tests distinct from Java/TLC execution, chart/report/counterexample/replay evidence; live blocked pending toolchain. |
| `scripts/pi-runtime.mjs`, `reground-from-cursor.mjs`, package tests | R/W; development-only conversion/sync fixtures. | Existing deterministic suites prove generated contract/resource preservation, not execution of every generated workflow. |

## Failure, interruption, and resume campaign

Apply these cases only to workflows that depend on the relevant facility.

1. Config: absent, malformed JSON, invalid scalar/list selector, repeated seats, unsupported role, unwritable path, and canceled picker.
2. Resources: extension-only load, disabled skill, missing linked reference, missing executable, and child missing required MCP access.
3. Delegation: invalid selector rejected before inference, one completed reviewer plus one failed seat, wrong acceptance role, forbidden write attempt with read-only tool allowlist, rejected named-parallel child controls, and effective thinking mismatch.
4. Lifecycle: interrupt before first tool, after one bounded mutation, and while a finite watcher waits; retain state, stop exact run IDs, then resume from the latest returned run ID or use fresh consolidated context as the workflow requires.
5. Resume: valid persisted session, wrong-cwd transcript, abandoned branch, missing run record, rejected retained resume, and explicit same-role fresh fallback only where the workflow allows it.
6. Publication: fake forge reports ready but SHA/base changed, dirty worktree, missing independent review, or noncontiguous green stack; none authorizes a real external action.

Do not force a real unavailable-model network request to prove account access failure.
The historical Codex account failure is evidence of that prior environment only, and Codex is outside the present model allowance.

## Bounded execution order and budget

This request implements targeted fixes and produces this plan; it does not start the exhaustive campaign.
Before each later wave, approve its exact scenario list and resource budget.

| Wave | Work | Proposed bound |
| --- | --- | --- |
| 0 | Package/root checks, skill inventory, plan linter, script deterministic tests and offline formal tests. | No model calls; 10 minutes; no downloads/network. |
| 1 | Commands, role picker, stock/patched host distinction, simple how, Interrogate, scalar writer. Reuse this session's proven scenarios. | At most 6 parent scenarios, 6 child launches, 40 minutes. |
| 2 | Arena, Architect, Swarm, Why/Teach, Reflect, Recall with bounded synthetic history. | At most 8 parent scenarios, 24 children, 75 minutes. |
| 3 | Local skill generators/maintenance, code-quality workflows, contextual prose/principle evaluations grouped by fixture. | At most 12 parent scenarios, 12 children, 75 minutes. |
| 4 | Remaining playbooks and fake Git/forge/scheduler failure/resume cases. | At most 10 parent scenarios, 16 children, 90 minutes. Real external effects remain gated. |
| 5 | Formal models, UI parity, video/renderers, actual TUI controls after prerequisites are provisioned. | At most 6 parent scenarios, 6 children, 60 minutes; no implicit provisioning. |

These are ceilings, not claims of measured cost or authorization to launch.
Use one active lead and at most two simultaneous children initially; widen only for a workflow whose semantics require it and whose budget was approved.
Set 4-minute parent and 3-minute read-only-child deadlines for tiny fixtures, leaving enough time for terminal evidence capture.
For mutation-capable children, narrow scope and use a generous outer deadline with checkpointing, not tight tool/token limits that can strand an edit.
Track reported tokens and cost after each scenario; pause a wave before a new launch if its approved spend ceiling is exhausted.
A proposed initial total is 1 million reported tokens; currency cost is unresolved until the configured provider's actual billing is known.
Never interpret that token proposal as a hard mutation-task safety boundary.
Retry the same failed launch at most once after recording state and diagnosing the failure; do not switch models/providers or orchestration surfaces to hide it.

## Artifact layout and final acceptance ledger

Use `<root>/<scenario-id>/` with `manifest.json`, `input.md`, `fixture-before/`, `fixture-after/`, `events.jsonl`, `sessions/`, `children/`, `checks.json`, `result.md`, and `cleanup.json` as applicable.
The manifest records source commit plus dirty diff hash, Pi/pi-subagents versions, host patch state, selected models, scoped config digest without secrets, explicit authority, cwd/ref, deadlines, and every created process/run/worktree ID.
`checks.json` separates deterministic checks from genuine model-driven assertions and lists skipped/gated criteria individually.
`cleanup.json` records stopped resources and confirms private auth/model copies were removed while evidence remains readable.
Redact before retention, particularly provider headers and authentication failures.

The final ledger must contain one outcome for each inventory row and each required variant: passed, failed, blocked with prerequisite/error, or instruction-only evaluated with rubric.
Attach exact evidence paths, observed side effects, and unexercised variants to each outcome.
Do not roll a subset pass into an all-workflows claim.
