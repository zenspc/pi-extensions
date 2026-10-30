# Review models in Pi

Read this before Arena or Interrogate delegation, including Architect's Arena runners.
The injected role table overrides workflow defaults and preserves one seat per array entry, in order.
`inherit-parent` and `auto` keep their seats but omit the subagent `model` override.
Without an explicit panel, Arena and Interrogate default to two parent-model samples.

Before launching, report each seat's effective `provider/modelId`, resolving inheritance against the current session model.
`/pstack status` shows configured effective selectors and availability in the current Pi registry; verify delegation-time choices with `subagent({ action: "models" })` as needed.
Use actual run metadata to report the models that ran, especially after a fallback or when the parent is a virtual model.
Label repeated models as a same-model panel, not multi-model or cross-family review.
Different provider/model selectors alone do not prove different model families.
Same-model sampling can still be useful, but it does not supply the different-model blind spots Interrogate seeks.

Keep inheritance as the safe default.
Offer `/setup-pstack` for an opt-in diverse panel using confirmed available selectors, preferably from different model families.
Do not silently select another paid provider or add reviewers merely to increase diversity.

If a configured selector is unavailable or rejected, name the failed seat and the error without losing completed results.
Where the workflow allows a fallback, retry that seat on the parent model by omitting `model`, and report the reduced diversity.
If the operator required a specific model or model diversity, report that seat blocked instead of substituting.
Do not infer fallbacks from Cursor-specific prefixes or invent effort/speed suffixes in Pi model IDs.
A missing reviewer is not a completed reviewer.
