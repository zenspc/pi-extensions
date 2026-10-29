---
"@zenspc/pi-pstack": patch
---

Fix Poteto Mode state and workflow parity in real Pi sessions.

- Make enabled and disabled mode state explicit to the model, and retain the absolute skill entry point after compaction.
- Restore the active branch's mode and status after tree navigation.
- Treat only exact off selectors as control commands, preserving tasks that start with stop, disable, or off.
- Reject activation without loaded skill resources and report the missing prerequisite in non-interactive sessions too.
- Preserve the why workflow's code anchor while adapting MCP discovery, and clarify delegated MCP tool requirements.
- Add real-session lifecycle and full-workspace resource regression coverage.
