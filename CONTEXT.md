# Pi Extensions

Installable packages that extend the Pi coding agent's behavior, TUI chrome, and workflows.

## Language

### Display

**Quiet Display**:
The default dense presentation of built-in tool activity: one thin quiet row per tool, success results summarized, multi-line bodies hidden until expand or hard breakthrough.
_Avoid_: Beautify mode, minimal mode, verbose-off, calm mode, focus mode

**Stock Display**:
Pi's normal built-in tool presentation, restored when Quiet Display is turned off.
_Avoid_: Default display (ambiguous once the package is installed), full mode, expanded mode

**Quiet Row**:
A single-line (or few-line) rendering of one built-in tool call in execution order, using thin chrome and per-tool success chips.
_Avoid_: Turn digest, tool card, log line

**Run Compaction**:
Merging adjacent successful Quiet Rows of the same tool kind into one grouped row (for example multiple reads in a row), with failures splitting out of the group.
_Avoid_: Turn digest, phase block, burst fold

**Success Chip**:
The short outcome fragment on a successful Quiet Row (counts, diff stats, exit code) without a multi-line body.
_Avoid_: Preview, summary (overloaded), badge

**Hard Breakthrough**:
Automatic elevation of a failed or erroneous tool result (error, non-zero exit, apply failure) that auto-expands a capped result body without the user expanding.
_Avoid_: Alert, promote, pin

**Soft Breakthrough**:
A compact, non-alarming outcome chip for empty-but-successful results (zero matches, empty stdout with exit 0) that does not auto-expand.
_Avoid_: Warning, failure

**Sticky Preference**:
The durable on/off choice for Quiet Display across sessions. Momentary per-row or global expand does not change it.
_Avoid_: Density setting, theme, expand state
