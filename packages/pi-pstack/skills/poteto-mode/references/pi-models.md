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
Same-model sampling can still be useful, but it does not supply cross-family blind spots.

Keep inheritance as the safe default.
Offer `/setup-pstack` for an opt-in diverse panel using confirmed available selectors, preferably from different model families.
Do not silently select another paid provider or add reviewers merely to increase diversity.

If a configured selector is unavailable or rejected, name the failed seat and the error without losing completed results.
Record rejected selectors and do not send them again in the same run.
Where the workflow allows a runner fallback, retry that seat on the parent model by omitting `model`, and report the reduced diversity.
For Arena runners and Interrogate adversaries, retain the requested seat count through allowed fallbacks, or report the missing seats explicitly.
If the operator required a specific model or model diversity, report that seat blocked instead of substituting.
Do not infer fallbacks from Cursor-specific prefixes or invent effort/speed suffixes in Pi model IDs.
For confirmed runtime reasoning controls that preserve the base selector, read [Pi delegation controls](pi-delegation.md).
A missing reviewer is not a completed reviewer.

## Arena cross-judge

The cross-judge pool supplies choices for one judge, not extra panel seats.
Try approved, available entries from a different model family than the parent's, in pool order.
`auto` and `inherit-parent` never judge, and a thinking suffix does not create a different family.
Do not fall back to the parent model or an unconfigured provider for this role.
If no eligible entry runs, or the parent's family cannot be verified, skip the judge and disclose the reason.
The parent still scores every candidate and picks the base in Phase D.
With the default inherited pool, there is no cross-family judge until the user configures one.
