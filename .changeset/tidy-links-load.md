---
"@zenspc/pi-pstack": patch
---

Load a role table that is a symlink to a regular file. Home Manager, stow, and
chezmoi install a managed file as a symlink, and `loadConfig` rejected it through
`lstatSync().isFile()` and returned the all-inherit default in silence. A symlink
that resolves to a regular file now loads. A dangling link, or a link to anything
else, still returns the default, and `saveConfig` still refuses to write through a
link.
