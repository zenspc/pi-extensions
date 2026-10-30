# Pi delegation controls

Read this before launching a read-only delegate or a panel with per-child controls.
Use the installed pi-subagents skill and guide for the current API.

## Read-only workers

The bundled pi-subagents `worker` declares `acceptanceRole: writer`.
Restricting its tools does not change acceptance inference.
For a review-only `worker`, use fresh context, an explicit read-only tool allowlist such as `read,grep,find,ls`, and this per-run policy:

```json
{"acceptance":{"level":"none","reason":"Read-only analysis; no implementation or mutation evidence is expected."}}
```

On a direct `subagent` call, put `acceptance`, `context`, and `tools` inside `options`.
On each scripted `runs.run` or `runs.all` child, put them directly on the child item.
Do not use the deprecated `acceptance: false` shorthand or change global worker acceptance settings.
For an agent declared `acceptanceRole: read-only`, omit acceptance and keep its tools restricted.
Retain inferred or explicit evidence gates for code-writing delegates.
The parent still checks review findings, terminal metadata, and the unchanged fixture; acceptance level `none` is not a review verdict or a filesystem sandbox.

## Panels and reasoning

When a named parallel resource cannot express per-child controls, use a native workflow script with `runs.all` and a stable key for each child.
Keep the complete model, tools, context, and acceptance policy on each child; do not strip controls to make a launch pass.
Use native async completion delivery, not polling or manual Pi subprocesses.

Dispatch-level `thinking` is ignored by pi-subagents 0.84.
For this runtime, pass a configured `provider/modelId:level` selector unchanged as the child's `model`, or use an agent's settings-level `thinking` override, and verify the effective level in terminal metadata.
`/setup-pstack` offers the selected model's supported levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
Its `default` choice stores no suffix and leaves effort to the delegated agent's defaults.
Unsuffixed `inherit-parent` and `auto` still omit `model` and do not pin effort.
A thinking suffix is a runtime control, not a different model ID or permission to change the configured base selector.
Different efforts on the same base model do not supply model diversity.
Do not invent speed suffixes or enable paid fast mode without authorization.
