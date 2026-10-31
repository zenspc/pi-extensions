# pi-autopilot

Autonomous Supervisor-Worker orchestration for Pi 1.4.0+.
Your current main model is the supervisor; every scout, coder, and reviewer gets an explicit authenticated model ID and isolated context.
This package starts at version `0.0.0`.

## Load and reload

From this monorepo:

```bash
pnpm install --ignore-scripts
pnpm --filter @zenspc/pi-autopilot check
pnpm --filter @zenspc/pi-autopilot test
pi -e ./packages/pi-autopilot
```

Inside Pi:

```text
/reload
/autopilot-models
```

For persistent installation, run this from the monorepo root:

```bash
pi install "$(pwd)/packages/pi-autopilot"
```

Then run `/reload` in your existing Pi session.
The extension is also declared in this monorepo's root `pi.extensions` manifest.
Do not load two different copies of the package at once.

## Model configuration

`/autopilot-models` runs `pi --list-models` with unrelated extensions/MCP/skills disabled, then asks you to select a primary model and thinking level for each tier: scout, fast, standard, deep, and reviewer.
It saves `.pi/autopilot/models.json` only after all model and thinking selections are complete.
Cancel any selection to leave the existing configuration unchanged.
The command requires a UI, either interactive Pi or a compatible RPC client.
It only discovers models available to your authenticated Pi CLI, not unauthenticated catalog entries.
Built-in providers and providers configured through Pi's `models.json` are supported; providers that require another executable extension are not loaded into workers.
Log in through Pi before discovery if no models are available.
No credential is stored in autopilot's configuration.

Initial routing prefers fast/mini/flash/haiku models for scouting, routine coding, and review, and reasoning/pro/opus models for deep work.
These are name-based suggestions, not a claim about price or capability.
Each model picker lists the current primary first, or a suggested primary if the previous choice is no longer available.
The following thinking picker lists the saved level first, clamped to the selected model’s supported levels when Pi has its metadata.
Non-reasoning models offer only `off`; reasoning models can also offer `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, depending on support.
If model metadata is unavailable, all Pi levels are offered and workers clamp the choice at execution.
Initial thinking suggestions are `low`, or `high` for the deep tier.
Repeated discovery preserves still-available choices and saved thinking levels, and removes unavailable fallback IDs.
Selecting a fallback as the primary removes it from that tier’s fallback list.
Edit `models.json` to customize fallback order.

The format is below.
The IDs are illustrative: replace them with exact IDs from the generated `available` array, including the provider prefix.

```json
{
  "version": 1,
  "discoveredAt": "2026-01-01T00:00:00.000Z",
  "available": ["provider-a/fast-model", "provider-a/deep-model", "provider-b/backup-model"],
  "tiers": {
    "scout": { "primary": "provider-a/fast-model", "thinkingLevel": "low", "fallbacks": ["provider-b/backup-model"] },
    "fast": { "primary": "provider-a/fast-model", "thinkingLevel": "low", "fallbacks": ["provider-b/backup-model"] },
    "standard": { "primary": "provider-a/fast-model", "thinkingLevel": "medium", "fallbacks": ["provider-b/backup-model"] },
    "deep": { "primary": "provider-a/deep-model", "thinkingLevel": "high", "fallbacks": ["provider-b/backup-model"] },
    "reviewer": { "primary": "provider-a/fast-model", "thinkingLevel": "low", "fallbacks": ["provider-b/backup-model"] }
  }
}
```

Use another provider for quota fallbacks; changing models within an exhausted provider will not bypass its quota.
The supervisor explicitly chooses each task's model from this catalog.
Workers never inherit the main model implicitly.
Configured thinking levels apply to the tier’s workers, including scouts, reviewers, quota fallbacks, and deep-tier retries.
Pi clamps thinking levels to each model's supported capabilities.
Existing configurations without `thinkingLevel` remain valid and retain task-selected levels, low-thinking scouts/reviewers, and high-thinking deep retries.
Pause the run before refreshing or editing routing configuration, then resume to reload it.

## First autonomous test

Use a disposable, clean Git repository, not this checkout with uncommitted development changes.
Git needs your normal author name and email configured before the initial commit and before autopilot can create local checkpoints.
No commits add an agent co-author.

From the monorepo root:

```bash
autopilot_package="$(pwd)/packages/pi-autopilot"
testdir=$(mktemp -d)
cd "$testdir"
git init
git commit --allow-empty -m "Initialize autopilot test"
pi -e "$autopilot_package"
```

Then, in Pi:

```text
/reload
/autopilot-models
/autopilot Create hello.ts exporting add(a: number, b: number): number, and hello.test.ts with node:test and node:assert/strict regression tests for positive and negative inputs. Do not add dependencies. Verify using node --experimental-strip-types --test hello.test.ts.
/autopilot-status
```

Expected outcome: scouting finishes, the supervisor saves the DAG, a worker implements the code in a detached worktree, verification passes, an independent read-only reviewer accepts it, and a local checkpoint commit appears in the main checkout.
`/autopilot-status` eventually reports `completed`, with every task `verified`.
The test consumes authenticated model usage; automated package tests use fake worker responses and real temporary Git repositories instead.

## Commands

| Command | Behavior |
| --- | --- |
| `/autopilot <goal>` | Start a new run, scout, plan, and execute without clarification dialogs. |
| `/autopilot-resume` | Recover the current journal/DAG and continue unverified tasks. |
| `/autopilot-resume --auto-wait` | Also wait 15 minutes and retry when configured providers exhaust their quota. |
| `/autopilot-status` | Show Scouted, Pending, Running, Verified, Retrying, Paused, Failed, spawn totals, and active worker model IDs. |
| `/autopilot-models` | Discover authenticated models, select each tier’s primary and thinking level, and save routing configuration. |
| `/autopilot-pause` | Finish the current batch, including tests/review, but launch no retry or subsequent batch. |
| `/autopilot-stop` | Abort active workers and verification commands, terminate process groups with SIGTERM then SIGKILL, discard isolated changes, and save resumable state. |

Escape is consumed while autopilot is active, including Kitty-protocol Escape sequences.
Parent tool cancellation signals are deliberately not used as worker cancellation signals.
Use pause or stop for explicit orchestration control.
Reload, session replacement, and process shutdown stop active workers and persist state; use resume afterward.
A hard blocker after three failed attempts or a safety ceiling is not reset by resume.
A fresh goal requires the preceding run to be completed or explicitly stopped.

## Execution and recovery

1. `run_scouts` launches 1-3 parallel read-only scouts using `read,grep,find,ls` and the scout tier’s thinking level (low by default), returning a combined brief bounded to about 500 tokens.
2. `save_or_update_plan` validates a nonempty acyclic DAG with explicit models, tools, detailed acceptance criteria, test commands, and exact repository-relative file reservations.
3. `dispatch_subagents` accepts only pending tasks with verified dependencies and non-overlapping reservations, with at most three coders running in parallel.
4. Each worker runs `pi --mode json --no-session --model ... --thinking ... --tools ... -p ...` with `CI=true` and `GIT_TERMINAL_PROMPT=0`.
   Unrelated extensions, MCP, skills, and prompt templates are disabled; only the worker guard extension is loaded.
5. Verification, review, and publication are serialized.
   If another independent task advanced the main branch, its changes are incorporated into the next worker's worktree before verification.
6. A task is verified only after its command exits zero, a separate read-only reviewer accepts the actual diff, and publication creates a local checkpoint.
   Publication checks for concurrent user changes and will not overwrite them.
7. Failed attempts retain a bounded error trace and diff, remove the entire isolated worktree, and retry from a clean checkpoint.
   Attempts 2/3 for fast or standard tasks use the deep tier’s model and thinking level (high by default).
8. Provider quota errors switch to configured fallback providers without consuming verification retries.
   Exhaustion saves unresolved tasks as `paused_quota` and pauses or enters 15-minute auto-wait.

The main model gets the supervisor prompt through `before_agent_start` and automatic continuation through `agent_end`.
Only the three orchestration tools are exposed to it while autopilot is active.
The chosen main model is not switched automatically; if its provider fails with a quota error, the run pauses and the same main model can be retried by resume/auto-wait.

State lives under `.pi/autopilot/`:

- `models.json`: authenticated catalog and five tier routes.
- `run.json`: crash-recovery journal during Phase 0, before `plan.json` exists.
- `plan.json`: versioned persistent task DAG after scouting and planning.
- `lock.json`: exclusive repository-controller ownership, with stale PID recovery.
- `worktrees/<run-id>/<task-id>`: disposable detached worktrees, removed after success or rollback.

Every worker spawn is journaled before launch and after exit using fsync and atomic rename.
Milestones also use `pi.appendEntry("autopilot", ...)`.
The plan tracks process identities/tokens for crash recovery and publication intent for the commit/state-write gap.
Resume terminates recorded surviving workers, discards interrupted worktrees, recovers any already-published checkpoint, and skips verified work.
Node, Git, an initial commit, a clean main checkout, and a working authenticated `pi` on `PATH` are required.
Linux and macOS are supported; use WSL on Windows because process-group termination is required.

### Task schema

Each persisted task includes `id`, `title`, `description`, `dependencies`, `role`, `complexityTier`, `model`, `thinkingLevel`, `allowedTools`, `filesToTouch`, `verificationCommand`, `status`, `retries`, `gitCheckpoint`, `resultSummary`, and `lastError`.
The controller owns status, retries, result/error data, Git checkpoints, worktree location, and publication intent; the supervisor cannot claim verification by editing a plan.
Task states are `pending`, `running`, `verified`, `failed`, and `paused_quota`.
`retries` counts failed attempts, with a hard ceiling of three failed attempts total.
Roles are `scout`, `coder`, and `reviewer`; task complexity tiers are `scout`, `fast`, `standard`, and `deep`.

Reservations are exact files, including any tests and lockfiles a coder will edit.
Directories, globs, symlinks, `.git`, `.pi`, `node_modules`, and traversal paths are not reservable.
Fresh worktrees contain committed files only, not the main checkout's untracked files or installed dependencies.
Have the supervisor include non-interactive dependency setup in verification when needed, and keep generated build/install artifacts Git-ignored.
Unexpected non-ignored files fail reservation validation.

### Circuit breakers

- Hash tool name and exact arguments on tool-call/start events, never tool results.
  A repeating pattern of 1-3 identical calls repeated four times terminates the worker.
- Terminate after five minutes without any stdout bytes, even if stderr remains active.
- Terminate after ten minutes total or more than 30 worker turns.
- Allow at most 64 worker/reviewer/scout spawns per run, persisted across resume.
- Bound JSON records and captured diagnostics, reject malformed streams, and clean up background process groups.
- Block after three supervisor runs without scouting/verification progress or 128 supervisor turns.

## Security and limitations

Running `/autopilot` authorizes unattended local code execution and local checkpoint commits for the goal.
Review the extension and use a disposable repository for the first run.
There are no interactive approval dialogs in this workflow.
No automatic push, deployment, package publication, or external-system action is part of the workflow.

Worktree isolation and reservation validation protect publication into the main checkout; they are not an operating-system sandbox.
The guard rejects direct out-of-reservation writes, symlink escapes, unlisted tools, and any reviewer bash command other than the prescribed `git diff`.
Scouts have no shell or write tools.
A coder's `bash`, dependency installers, and verification commands still run with your user's filesystem/network permissions and inherited provider credentials, and could escape a worktree if malicious.
Do not use this with hostile code or goals; use a container/VM and scoped credentials when OS-level containment is needed.
The independent model review is a correctness gate, not proof against a malicious worker.

Errors, test output, diffs, goals, and worker summaries are retained in local state and sent to the configured worker/reviewer providers.
Do not include secrets in goals, and inspect/redact state before sharing it.
Add `.pi/autopilot/` to the project's `.gitignore` if `.pi/` is not already ignored; the controller also excludes its state from clean-check checks and refuses tracked autopilot state.
The run will stop on missing credentials, invalid configuration, persistent failures, or quota exhaustion rather than inventing successful completion.

## Development checks

```bash
pnpm --filter @zenspc/pi-autopilot check
pnpm --filter @zenspc/pi-autopilot test
pnpm check
pnpm test
```

Tests cover real temporary Git worktrees/checkpoint commits, DAG validation, parallel workers and serialized verification, clean retries, escalation, reviewer rejection, quota fallback and auto-wait, pause/stop, publication recovery, file-reservation enforcement, JSON framing, subprocess watchdogs, and the Pi command/event contract.
The tests do not make paid model calls.
