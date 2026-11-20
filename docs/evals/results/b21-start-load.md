# Build 21: what loads at the start of a session (2026-11-20)

Method: two fresh probe folders, each holding only the project CLAUDE.md and AGENTS.md of one side (main at ec73f1d,
released 1.46.1; this branch at bf6c9a0), the owner's own user layer, one `claude -p /context` session on the top
model. The report needs no model call. Token counts are Claude Code's own estimates.

| Piece | 1.46.1 (ec73f1d) | 1.47.0 (bf6c9a0) | Change |
|---|---|---|---|
| AGENTS.md, bytes on disk | 23,834 | 19,467 | -4,367 (-18.3%) |
| AGENTS.md, tokens | 8.5k | 6.9k | -1.6k (-19%) |
| Project CLAUDE.md, tokens | 2.2k | 2.2k | 0 |
| Memory files, all | 13.1k | 11.6k | -1.5k |

Not measured: the MCP tool lines, which differed between the two sessions by what servers had connected, not by the kit.
