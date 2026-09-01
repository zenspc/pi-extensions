# @zenspc/pi-pstack

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
