---
name: setup-pstack
description: Configure which models pstack uses per role. Use for /setup-pstack, /skill:setup-pstack, or changing pstack's model choices.
disable-model-invocation: true
---

# Setup pstack

Run the `/setup-pstack` command.
It lists models configured for this Pi session and writes `~/.pi/agent/pstack/models.json`.

If the command is unavailable, write that JSON yourself:

- `version`: `1`
- `roles`: one key per role listed below
- each value is `inherit-parent`, `auto`, a `provider/id` selector, or an array of those
- never write a selector you have not confirmed is available
- start every role at `inherit-parent` unless the user chose a model

Roles: feature, refactoring; bug-fix; perf-issue; hillclimb; judgment and prose; hardest tasks; how explorer; how explainer; why investigators; why synthesizer; reflect tooling; reflect judgment, divergent, synthesizer; arena runners; arena cross-judge pool; swarm workers; architect runners; interrogate reviewers.

Panel roles (`arena runners`, `architect runners`, `interrogate reviewers`) are arrays: one subagent per entry, including inherited or repeated entries.
`arena cross-judge pool` is an ordered array of choices for one judge, not one judge per entry.
Arena tries only approved, available entries from a model family other than the parent's, in list order.
`auto` and `inherit-parent` never judge.
If no eligible entry runs or the parent's family cannot be verified, Arena skips the judge and the parent picks the base alone.
A scalar `inherit-parent` or `auto` leaves the workflow's default panel size; an explicit array sets its size, even with one inherited entry.

Run `/pstack status` to see the effective panel selectors and whether a panel uses the same model repeatedly.
For opt-in diversity, choose only models the user has approved from the available registry, preferably from different families.
Never select additional paid providers automatically.
If status reports a broken or partially rejected config, repair it or move it aside before setup; do not overwrite it with defaults.

The file is user-level.
Do not commit it.
If `~/.pi/agent/pstack-models.md` exists and the JSON does not, the extension migrates it on session start.

After writing, tell the user it applies to new turns.
Offer `/skill:create-verification-skill` once if the project has no verify skill, same as before.
