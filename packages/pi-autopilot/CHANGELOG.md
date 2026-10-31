# @zenspc/pi-autopilot

## 0.1.0

### Minor Changes

- ceaa436: Add interactive model and thinking-level selection for each autopilot routing tier.
  Save configuration only after all selections are complete, preserve existing configuration on cancellation, and apply configured thinking levels to workers, scouts, reviewers, quota fallbacks, and deep-tier retries.

## 0.0.1

### Patch Changes

- 5a8dbea: Add autonomous Supervisor-Worker orchestration with persistent task DAGs, explicit model routing, isolated worktrees, verification and independent review, bounded retries, quota recovery, and pause/stop/resume commands.
