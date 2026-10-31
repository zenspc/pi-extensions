### Orchestrate

Read [Pi runtime prerequisites](../references/pi-runtime.md) before scheduling work or locating transcripts and durable artifacts.

**You run the program, never the code.
Decide which agent does each piece of work, then check what each one produces.** For a standing project handed to one coordinator chat: multi-day, many stacked PRs, dozens to hundreds of subagents, few human turns.
One task driven to a predicate is Autonomous run.
One ambitious run that needs a bespoke workflow is figure-it-out.
Work that one agent could finish inside the session's budget is not a program.

Run it with your own tools.
Spawn workers through pi-subagents after reading the pi-subagents skill and confirming delegation authority.
Keep the program's state in a task-scoped artifact directory recorded per the Pi runtime prerequisites, using the host task tracker when available.
Watch PR and CI events only with verified delivery; otherwise checkpoint external waits.
Do not add coordination scripts or polling loops, and do not act as a message relay between workers.

#### Topology

- **One owner per PR.** The owner is the only writer of its branch and carries the PR from build to merge.
  Only the owner pushes, rebases, or retargets it.
  Closing or retargeting a base PR orphans every PR above it, so the owner does that only on your call.
  You never author or edit code.
  Conflicted merges, chain rebases, and fixes go to owners.
- **A fresh worker for each independent task.** Its kickoff carries everything it needs, including each upstream report it depends on, pasted in full.
  Workers can't see their siblings.
  Use `worktree: true` for code-writing lanes, with one writer per worktree.
  Use an explicit `cwd` for checks that need this machine's runtime, transcripts, simulator, or credentials.
  Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.
- **A sub-coordinator only when one area has many parallel workers.** It owns that area's workers and kickoffs and sends you one rollup, never raw worker reports.
  Allow nested delegation only when the parent authorized it and the child's tools include subagent; obey pi-subagents depth limits, with at most you, sub-coordinators, and workers.
  Keep about ten workers in flight per coordinator, and start the next one as each finishes instead of waiting on a whole batch.
- **Resume a retained worker only for a follow-up on the same work.** Steer a live child; resume a completed or paused child using its latest run ID.
  Give independent work a fresh worker and the required branch or artifact pointers.
  Do not message a worker to check on it; use read-only retained-run status and PR activity.
- **Each PR gets a verifier that isn't its author,** on a different model family.
  The owner merges only on that verifier's pass at the current head and within the operator's merge authority.
  If no approved different-family verifier is available, report verification blocked rather than silently substituting.
- **Start with one unit.** Take it through kickoff, owner, verifier, and merge before you fan out, so a flaw in the kickoff costs one agent instead of fifty.
  On near-identical cheap units, the first unit is that test.

#### Supervision

- **Each kickoff names the evidence that proves the work is done,** such as a command and its expected output, a control-skill check, or an artifact.
  It also names the goal, the paths the worker may and may not write, and the actions it must not take.
  If you can't name the evidence, the unit isn't scoped yet.
- **Read the diff or the artifact, not only the worker's summary.** Green CI is an input to a verdict, not a verdict.
  Behavioral work needs more than a type check.
  A verdict covers one head SHA, so a new push needs a new verdict.
  Read a sample of each sub-coordinator's kickoffs while its workers run, and fix its instructions when one fails.
- **Send back work that drifts from scope or grows past what was asked.** Keep only the fixes that block the program, and park the rest as follow-ups.
- **Check a PR's live state before you report on it,** with `gh pr view` and `gh pr checks` or your forge's equivalents, not the worker's last report.
  Account for every worker you spawned as done, replaced, or absorbed into another worker's scope.
- **Stop or replace a worker that stalls or loops.** Judge it by its pushes and PR activity, not its status text.
  Retry by cause: a smaller scope after a context or memory limit, the same kickoff after a dropped connection, and a different model after a tool error.
  After two retries, drop the unit and replan around it.
  When a stopped worker returns late, check its result against the PR's current state, and hand any unique findings to a fresh worker.
- **Ask the user only for a real decision or a blocker,** such as an irreversible action, a product or preference call that no experiment settles, or a dead end that survived a replan.
  Rebase mechanics, retries, CI flakes, review triage, and "should I keep going" never reach the user.

**Reply:** what landed against the goal, each PR's live state and verdict with its link, what was dropped and why, and the decisions waiting on the user.
