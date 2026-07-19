---
"@zenspc/pi-sticky-editor": minor
---

Add `@zenspc/pi-sticky-editor` to keep the Pi editor and footer fixed while the transcript scrolls.

- Splits the terminal into a scrollable transcript region and a fixed editor region
- Keeps editor, footer, autocomplete, and above/below-editor widgets pinned
- Mouse wheel and PageUp/PageDown scroll only the transcript
- Enter jumps the transcript back to the bottom
- Print mode and RPC mode are unaffected
