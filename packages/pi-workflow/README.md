# @zenspc/pi-workflow

Plan mode for read-only exploration and tracked plan execution in Pi.

## Install

```bash
pi install npm:@zenspc/pi-workflow
```

Local development:

```bash
pi -e ./packages/pi-workflow
pi install ./packages/pi-workflow
```

## Features

- Built-in write tools disabled while planning
- Bash restricted to allowlisted read-only commands
- Extracts numbered steps from `Plan:` sections
- Progress tracking widget during execution
- `[DONE:n]` markers for step completion
- Session persistence across resume

## Commands

- `/plan` - toggle plan mode
- `/todos` - show current plan progress
- `Ctrl+Alt+P` - toggle plan mode
- `--plan` - start Pi already in plan mode

## Usage

1. Enable plan mode with `/plan` or `--plan`.
2. Ask the agent to analyze code and create a plan.
3. Prefer a numbered plan under a `Plan:` header:

```text
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose execute when prompted.
5. During execution, the agent marks steps complete with `[DONE:n]`.
6. The progress widget shows completion status.

## How it works

### Plan mode

- Built-in `edit` / `write` tools disabled
- Other active tools remain available
- Bash filtered through a read-only allowlist
- Agent explores and drafts a plan without mutating files

### Execution mode

- Full tool access restored
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress

### Command allowlist

Safe examples:

- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked examples:

- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`

## Source

```text
extensions/plan-mode/index.ts
extensions/plan-mode/utils.ts
```
