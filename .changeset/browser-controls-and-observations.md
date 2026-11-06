---
"@zenspc/pi-browser": minor
---

Add keyboard input, document and nested-container scrolling, native dropdown selection, and visible-text waits.
Navigation and actions now return fresh bounded Snapshots with Element Refs, CSS viewport dimensions, and document scroll position.
Keep the native resizable Chrome viewport and flush its initial compositor frame before interaction.
Include bounded dropdown option values and selected state, and avoid repeating completed actions when a follow-up Snapshot fails.
