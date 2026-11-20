# Build 21: what loads at the start of a session (2026-11-20)

Method: two fresh probe folders, each holding only the project CLAUDE.md and AGENTS.md of one side (main at ec73f1d,
released 1.46.1; this branch at e7a71ce), the owner's own user layer, one `claude -p /context` session on the top
model. The report needs no model call. Token counts are Claude Code's own estimates.

| Piece | 1.46.1 (ec73f1d) | 1.47.0 (e7a71ce) | Change |
|---|---|---|---|
| AGENTS.md, bytes on disk | 23,834 | 21,304 | -2,530 (-10.6%) |
| AGENTS.md, tokens | 8.5k | 7.6k | -0.9k (-11%) |
| Project CLAUDE.md, tokens | 2.2k | 2.2k | 0 |
| Memory files, all | 13.1k | 12.3k | -0.8k |

Not measured: the MCP tool lines, which differed between the two sessions by what servers had connected, not by the kit.
