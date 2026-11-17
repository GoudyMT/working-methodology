# E4: what loads at the start of a session (2026-11-17)

Method: a fresh probe folder with the project layer installed (`kit.mjs install project`), the owner's own user layer
and plugins, one `claude -p /context` session on the top model. The report needs no model call. Released 1.41.0
against this branch (1.42.0). Token counts are Claude Code's own estimates.

| Piece | 1.41.0 | 1.42.0 | Change |
|---|---|---|---|
| AGENTS.md, bytes on disk | 27,609 | 23,834 | -3,775 (-13.7%) |
| AGENTS.md, tokens | 9.8k | 8.5k | -1.3k (-13%) |
| Project CLAUDE.md, tokens | 2.1k | 2.1k | 0 |
| Memory files, all | 15.5k | 14.2k | -1.3k |
| Skills (every source) | 10k | 10k | 0 |
| Custom agents | 602 | 602 | 0 |
| Start-up total | 47.9k | 46.8k | -1.1k |
| Context window shown | 650k | 400k | the compact window (autoCompactWindow 400000) |

Plugins: the security-guidance plugin adds hooks only and shows no skill, agent or tool at start, so it costs 0 tokens
of the start-up load. Recommendation: keep it on (the owner's own setting). The plugin skill lists that do load
(engineering, product-management, design, cowork-plugin-management, claude-code-setup) come to about 2.8k tokens; they
are the owner's choice, not kit text.

Not measured: the per-edit cost of the security-guidance hooks (they add text only when an edit matches their
patterns).
