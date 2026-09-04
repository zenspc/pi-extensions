# @zenspc/pi-pstack

pstack for Pi: rigorous agent workflows you can parallelize with confidence. Ported from the Cursor pstack plugin.

If you want to go fast, go deep first. pstack helps you write less, but higher quality code. It gives you fearless parallelism: when an agent goes deep and writes good, verifiable code, you can parallelize with confidence. Start multiple agents with `poteto-mode` and trust they will apply rigorous engineering principles to their work.

## Install

```bash
pi install npm:@zenspc/pi-pstack
```

Requires [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) for the `poteto-agent`, `comment-sicko`, and workflow fan-outs (`how`, `why`, `arena`, `swarm`, `interrogate`, `reflect`).

## Get started

1. Run `/setup-pstack` once to pick which models each role uses (optional; every role inherits the parent session model otherwise).
2. Use `/poteto-mode` for sticky Poteto Mode. It stays on until `/poteto-mode off`. `/skill:poteto-mode` also enables it.
3. Run `/pstack off` to hide even the four Discoverable skills (`how`, `why`, `unslop`, `typescript-best-practices`) from the Skill catalog.
   Off persists in `~/.pi/agent/pstack/models.json`.
   `/skill:<name>` keeps working.
   `/pstack on` restores those four, not all 45.

That is it.
The other skills are Hidden; the mode skill uses them as needed.

## What you get

- **45 skills**, including:
  - `poteto-mode`: the main entry point. Reads your request, matches one of 22 playbooks (bug fix, perf, feature, refactoring, investigation, shipping, orchestrate, autopilot, and more), copies its steps in verbatim, and routes to the other skills as steps fire.
  - Workflow skills: `how`, `why`, `recall`, `blast-radius`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `teach`, `tdd`, `no-comments`, `unslop`, `deslop`, `bro`, `figure-it-out`, `show-me-your-work`, `create-verification-skill`, `maintain-verification-skill`, `automate-me`, `technical-writing`, `typescript-best-practices`.
  - 21 principle skills (`principle-laziness-protocol`, `principle-model-the-domain`, `principle-prove-it-works`, ...), one rule each, indexed inline by `poteto-mode`.
- **2 subagents** (loaded by pi-subagents):
  - `poteto-agent`: runs poteto's style end to end. Reads `poteto-mode` in full before any work.
  - `comment-sicko`: read-only comment reviewer that savors deletion. Usually invoked through the `no-comments` skill.
- **Bundled scripts**: `poteto-mode/scripts/` ships the `orch` coordination CLI (orchestrate playbook) and the `watch-pr` watcher (babysit playbook). Both run under [bun](https://bun.sh).

## Model roles

Per-role model choices live in `~/.pi/agent/pstack/models.json`. Run `/setup-pstack` to write it. The extension injects the role table only when a role has a real model slug. Default inherit-all injects nothing. `inherit-parent` or `auto` runs on the parent session model.

## Differences from the Cursor plugin

- Hidden skills set `disable-model-invocation: true`, so they stay out of the Skill catalog.
  `/skill:name` still loads the Skill body.
  The four Discoverable skills are `how`, `why`, `unslop`, and `typescript-best-practices`.
- Slash commands are `/skill:<name>` instead of `/name`.
- Subagent delegation uses pi-subagents (`subagent({ agent, task })`) instead of Cursor's Task tool. This package does not ship a replacement `subagent` tool.
- Session transcripts live under `~/.pi/agent/sessions/` instead of `~/.cursor/projects/`. The active file is `$PI_SESSION_FILE`. Files are grouped by cwd slug (`--<cwd>--`, absolute cwd with `/` replaced by `-`).
- The benny automation pack is not ported; it depends on Cursor automations. Model roles live in `~/.pi/agent/pstack/models.json`, written by `/setup-pstack` and injected only when a role has a real model slug.
- `make-bot-ui` is not ported. It is Cursor Grok Bot / routine webhook UI.

## License

MIT
