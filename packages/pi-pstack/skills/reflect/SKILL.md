---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

- The user said "reflect" or "/skill:reflect".
- A complex task (5+ tool calls) just landed cleanly and the recipe is worth keeping.
- The agent hit dead ends, found the working path, and the path generalizes.
- The user corrected the agent's approach mid-task.
- A non-trivial workflow emerged that isn't captured anywhere.

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out.
The active Pi session file is `$PI_SESSION_FILE` (unset for ephemeral `--no-session` runs).
Use it directly when present.
To list earlier sessions for this same working directory, list `~/.pi/agent/sessions/--<cwd>--/` where `<cwd>` is the absolute cwd with every `/` replaced by `-` (example: `/home/you/proj` → `--home-you-proj--`).
Read only files under that directory.
Never glob `~/.pi/agent/sessions/*.jsonl` and never walk sibling cwd directories.
That crosses project boundaries and can read unrelated private chats.
If `$PI_SESSION_FILE` is unset and the cwd directory has no files, write a tight digest of the current session and pass that instead.

For each candidate, read the first JSONL line and check that `message.content[0].text` contains the conversation's opening user prompt. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead.

### 2. Spawn three reviewers in parallel

One message, one async workflowScript with three parallel children, `runs.all([...])`, agent `reviewer` or `worker`, explicit `model` on each. Reviewers need MCP access for context lookups (tickets, chat threads, observability traces referenced in the transcript). The prompt forbids file writes; the parent applies edits.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | your configured reflect-judgment model (default `inherit-parent`) | `references/judgment-reviewer.md` |
| Tooling | your configured reflect-tooling model (default `inherit-parent`) | `references/tooling-reviewer.md` |
| Divergent | your configured reflect-judgment model (default `inherit-parent`) | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their run output.

### 3. Synthesize

One child run using your configured reflect-judgment model (default `inherit-parent`), agent mode The synthesizer's quality check includes spot-verifying citations, which can require MCP access. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. The synthesizer already applies this criterion; this is a final pass before edits land. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org; do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Those are tracker submissions, not skill edits. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): author it with `playbooks/authoring-a-skill.md` and `/skill:unslop` and follow its draft / review / revise loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): narrow `description` to the phrases that should trigger it; do not add unknown frontmatter keys.
- `new skill: <kebab-name>`: follow `playbooks/authoring-a-skill.md` and `/skill:unslop`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
