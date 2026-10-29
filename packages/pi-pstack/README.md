# @zenspc/pi-pstack

Pstack for Pi provides rigorous agent workflows, playbooks, engineering principles, and multi-model review.
It is ported from [Cursor pstack](https://github.com/cursor/plugins/tree/main/pstack).

## Install

```bash
pi install npm:@zenspc/pi-pstack
```

Targets Pi `1.4.0`, the latest published release at this sync.
Install [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) for the bundled agents and delegated workflows.
Delegation still requires authorization from the operator's request or applicable user/project instructions.

## Get started

1. Run `/setup-pstack` to choose available Pi models for each role.
   This is optional; every role inherits the parent session model by default.
2. Use `/poteto-mode [task]` to enable sticky Poteto Mode.
   It stays on until `/poteto-mode off`.
   `/skill:poteto-mode` also enables it.
3. Use `/skill:poteto-help` for help choosing a skill or playbook.
4. Run `/pstack off` to hide the four Discoverable skills from the Skill catalog.
   The setting persists in `~/.pi/agent/pstack/models.json`.
   Explicit `/skill:<name>` commands still work.
   `/pstack on` restores those four, not all 58.

Only `how`, `why`, `unslop`, and `typescript-best-practices` are Discoverable.
All other skills are Hidden and load when invoked explicitly or routed to by a workflow.

## What is included

- **58 skills**, including `poteto-mode`, `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, and `reflect`.
- 23 playbooks for investigation, bugs, performance, features, refactoring, verification, PRs, and autonomous work.
- 24 principle skills, including Attack the Premise, Test Behavior Not Implementation, and Explain the Number.
- Help and communication skills, including `poteto-help`, `in-your-own-words`, `sharpen`, `ketchup`, and `ketchup-video`.
- Verification skills, including `benchmark-checklist`, `create-formal-verification-skill`, `maintain-formal-verification-skill`, and `statechart`.
- Two pi-subagents definitions, `poteto-agent` and the read-only `comment-sicko` reviewer.
  The parent chat runs the playbook; `poteto-agent` handles an assigned step.
- The bundled `orch` coordination CLI and `watch-pr` watcher, which run under [Bun](https://bun.sh).

The `statechart` skill checks TLA+ models and produces Mermaid charts and reports.
Its launcher supports Node 22.18-22.x, Node 23.6 or later, Bun 1.1.5 or later, or Deno 2.0 or later.
The first live model check installs TLC and Java through mise and requires network access.
View modules execute local code, so use only trusted models and views.

## Model roles and session state

`/setup-pstack` writes role choices to `~/.pi/agent/pstack/models.json`.
Use exact Pi `provider/modelId` selectors.
`inherit-parent` and `auto` mean omit the subagent model override.
No role table is injected when all roles inherit.

Poteto Mode is recorded in session entries and restored from the active branch on session start and tree navigation.
The model receives explicit on/off state after you select the mode.
While enabled, a lightweight instruction retains the absolute skill path so the agent can reload the full instructions after compaction.
The full skill body is not injected into every system prompt.
Only an exact `off`, `disable`, or `stop` argument disables the mode; longer arguments remain task text.
Missing skill resources produce an error rather than forwarding an unexpanded command.

The extension uses Pi's structured prompt options for its own `pstack` section and Skill catalog filtering.
It does not replace or parse the complete rendered prompt, mutate the skill registry, or remove other extensions' sections.

## Differences from Cursor

- Skill commands use `/skill:<name>`; `/poteto-mode`, `/setup-pstack`, and `/pstack` are extension commands.
- Hidden skills use `disable-model-invocation: true` but remain available through explicit commands.
- Delegation uses pi-subagents, not Cursor's Task tool or cloud-agent parameters.
  Read the pi-subagents skill for activation, isolated worktrees, retained runs, and model discovery.
  The bundled `poteto-agent` has read/search/shell/edit/write tools, not automatic MCP access.
  MCP-dependent work needs a configured agent definition that selects the required tools and loads their providers.
  Naming tools in a task brief does not grant access.
- Sessions live under `~/.pi/agent/sessions/`, with the active file exposed as `$PI_SESSION_FILE`.
- The Pi-specific `deslop` skill, JSON model configuration, plan checker, and worktree audit are preserved on sync.
- Cursor Custom Modes, recurring wakes, the benny automation pack, and `make-bot-ui` are not provided.
  Use a scheduler or watcher for recurring work and the project's verification harness for UI or CLI checks.

## Upstream sync and development

Synced from Cursor pstack `0.15.34` at [`519d36aa98955bf680db01bcde5fdfba686dc901`](https://github.com/cursor/plugins/commit/519d36aa98955bf680db01bcde5fdfba686dc901).

For local development, load the complete package with `pi -e ./packages/pi-pstack`, not just `extensions/pstack/index.ts`.
The monorepo package also exposes Pstack's skills and agents alongside its extension.
Install pi-subagents before testing delegation.

Review a sync before applying it:

```bash
node packages/pi-pstack/scripts/reground-from-cursor.mjs \
  --from /path/to/cursor-plugins/pstack \
  --to packages/pi-pstack --dry-run
```

Remove `--dry-run` to apply it.
The script limits command rewriting to Markdown, keeps Pi-only forks and recorded fixtures, applies toolchain compatibility patches, and updates catalog counts.
Its tests use temporary fixtures and do not require an upstream checkout.

```bash
pnpm --filter @zenspc/pi-pstack test

# Bun toolchain uses the existing bun.lock.
cd packages/pi-pstack/skills/poteto-mode/scripts
bun install --frozen-lockfile --ignore-scripts
bun test orch watch-pr

# Statechart has its own pnpm development toolchain.
cd ../../statechart/scripts
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm test
```

Statechart's recorded-corpus tests run without Java or TLC.
Renderer tests fetch pinned renderer packages into the user cache with lifecycle scripts disabled and require network access.
Optional differential tests require `TLA2TOOLS` pointing to `tla2tools.jar` and a Java runtime.

## License

MIT
