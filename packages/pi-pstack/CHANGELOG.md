# @zenspc/pi-pstack

## 0.9.0

### Minor Changes

- ee7db5d: Sync Cursor pstack 0.15.36 at c742dd6, including run-proven Interrogate findings, different-family Arena judges, revised Autopilot rules, subtitled catch-up videos, and measurement decision gates.
  Replace the retired orch CLI with Pi-native Orchestrate coordination while preserving delegation authorization, model/thinking selectors, runtime capability checks, and Pi-only tools.

## 0.8.0

### Minor Changes

- b32be3d: Add per-role and per-panel-seat thinking effort selection to `/setup-pstack` using native Pi model suffixes.
  Check model availability and panel diversity against base selectors while preserving effort in saved configuration and delegation prompts.

## 0.7.2

### Patch Changes

- 4a58dda: Preserve inherited and repeated model-panel seats, diagnose broken configuration without overwriting it, and show effective model choices and reduced review diversity.
  Replace upstream scheduler and transcript assumptions with Pi capability checks and safe fallbacks, preserving these adaptations through sync and regression tests.
  Run the existing Bun and statechart tool suites in CI, separating offline checks from network-dependent renderer tests.

## 0.7.1

### Patch Changes

- 4b859cc: Fix Poteto Mode state and workflow parity in real Pi sessions.

  - Make enabled and disabled mode state explicit to the model, and retain the absolute skill entry point after compaction.
  - Restore the active branch's mode and status after tree navigation.
  - Treat only exact off selectors as control commands, preserving tasks that start with stop, disable, or off.
  - Reject activation without loaded skill resources and report the missing prerequisite in non-interactive sessions too.
  - Preserve the why workflow's code anchor while adapting MCP discovery, and clarify delegated MCP tool requirements.
  - Add real-session lifecycle and full-workspace resource regression coverage.

## 0.7.0

### Minor Changes

- fa52a43: Sync Cursor pstack 0.15.34 at 519d36a, adding help, catch-up, benchmark, formal-verification, and statechart skills while preserving Pi-specific commands, model defaults, and catalog visibility.
  Use Pi 1.4 structured prompt options instead of rewriting rendered prompts, and keep the playbook in the parent chat while poteto-agent handles delegated steps.
  Make sync tests portable, preserve relative links and recorded fixtures, update the Pi plan checker's Markdown handling, and exclude nested development dependencies from published packages.

## 0.6.0

### Minor Changes

- 79943ee: Sync Cursor pstack 0.15.0. Add Attack the Premise and Test Behavior, Not Implementation. Drop how Critique Mode. Ship a re-ground lever for the next pull.

## 0.5.0

### Minor Changes

- 512f93b: Port Cursor pstack's forge-neutral PR playbooks, the verified multi-phase plan checklist, and TypeScript schema-at-boundary guidance.

## 0.4.0

### Minor Changes

- 818fef3: Hide 41 Pstack skills from the Skill catalog. `/pstack on` restores `how`, `why`, `unslop`, and `typescript-best-practices` only.

### Patch Changes

- 818fef3: Inject Cursor's Poteto Mode one-liner instead of the Skill body mandate. Skip the role table when every role inherits.

## 0.3.0

### Minor Changes

- 0ad52fa: Add `/pstack on|off|status` to hide pstack skill descriptions from the system prompt and persist the choice.

## 0.2.0

### Minor Changes

- eaec816: Add the deslop skill for AI code-slop cleanup.

  Point poteto-mode's before-commit trigger at `/skill:deslop`. Keep `/skill:unslop` on prose.

## 0.1.0

### Minor Changes

- 363ded6: New package: pstack for Pi. Ports the Cursor pstack plugin as 44 Agent Skills standard skills (poteto-mode with 22 playbooks, workflow skills, 21 principle skills) plus two pi-subagents agent definitions (poteto-agent, comment-sicko).
