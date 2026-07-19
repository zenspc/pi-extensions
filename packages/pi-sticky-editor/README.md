# @zenspc/pi-sticky-editor

Pin Pi's editor row to the bottom of the terminal so it stays put while the transcript scrolls above it.

## Compatibility

Validated on Pi / `@earendil-works/pi-tui` **0.80.x**.
This extension patches private TUI internals (`doRender`, `terminal.rows`, mouse/selection hooks, etc.).
Private-API drift in newer Pi releases may require a package update.
Peer floor is `>=0.80.0` (raised above the monorepo `*` convention because this package depends on private TUI hooks validated on 0.80.x).

## Install

```bash
pi install npm:@zenspc/pi-sticky-editor
```

Local development:

```bash
pi -e ./packages/pi-sticky-editor
pi install ./packages/pi-sticky-editor
```

## What it does

Pi normally scrolls the entire terminal surface. When you run a tool with a lot of output, the editor and footer drift out of view.

This extension splits the terminal into two regions:

- A **scrollable transcript region** on top.
- A **fixed editor region** at the bottom that holds the editor, footer, autocomplete, and any `aboveEditor` / `belowEditor` widgets.

While reading through tool output you scroll only the transcript.
The editor stays in place - you always know where your cursor is, and there's no need to scroll back down before typing your next message.

On Enter (query submit), the transcript jumps back to the bottom automatically.

Mouse wheel and PageUp / PageDown are routed to the transcript region only.

## What stays unchanged

- All editor behavior (keybindings, autocomplete, multi-line, paste) works exactly as before.
- Footer content is preserved (status indicators, token counts, etc.).
- No styling changes, no new commands, no settings, no custom shortcuts.
- Print mode and RPC mode are unaffected.
- Uninstall or disable the extension to return to Pi's default all-surface scrolling.

## Credits

Took some reference from [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) by Nico Bailon.

## License

[MIT](LICENSE)
