---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Before delegation, read [Pi delegation controls](../poteto-mode/references/pi-delegation.md) for read-only acceptance and per-child launch parameters.

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, locate the active Pi session or retained pi-subagents run through [Pi runtime prerequisites](../poteto-mode/references/pi-runtime.md).
Use only the verified workspace-scoped file or a bounded digest when it is unavailable.

## 2. Spawn three reviewers in parallel

One message, three `subagent()` launches, `agent: "worker"`, read-only tools plus the required MCP tools. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, so include those MCP tools explicitly.

Each reviewer and the synthesizer name a role line in the injected pstack role table and a default. Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the subagent tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | inherit-parent | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | inherit-parent | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | inherit-parent | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `subagent` response body.

## 3. Synthesize

One `subagent()` launch, `agent: "worker"`, `model` from the `reflect judgment, divergent, synthesizer` line (default inherit-parent), read-only tools plus the required MCP tools. It spot-verifies citations through MCP, so include those MCP tools explicitly. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill under `plugins/cache/`. Before approval, show its destination, `.pi/skills/<skill>/` or `~/.pi/agent/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to `playbooks/authoring-a-skill.md` skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `playbooks/authoring-a-skill.md` and run its description-optimization loop.
- `new skill via authoring-a-skill: <kebab-name>`: hand creation to `playbooks/authoring-a-skill.md`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
