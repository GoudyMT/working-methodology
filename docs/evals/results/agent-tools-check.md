# Agent roles: the tools and rules each really gets (Phase 2, unit 1)

Run 2026-10-28 with the claude CLI in a scratch project installed from kit 1.0.0, using the agents installed in
~/.claude. Each role was started through the Agent tool and asked, without using a tool, to list the tools it can
call and whether the core rules (a "Rule Modules" section) are in its instructions. These are the agents' own
reports, not a reading of the harness.

| Role | Foreground tools | Background tools | Sees the core rules |
|---|---|---|---|
| builder | Read, Edit, Write, Grep, Glob, Bash, PowerShell | the same | no |
| checker | Read, Grep, Glob, Bash, PowerShell | the same | no |
| scanner | Read, Grep, Glob | the same | no |
| orchestrator | Agent, ToolSearch, Read, Edit, Write, Grep, Glob, Bash, PowerShell; SendMessage, WebFetch, WebSearch deferred (loaded through ToolSearch) | Agent, ToolSearch, Read, Edit, Write, Grep, Glob, Bash, PowerShell; it named no deferred tools | no |

- Every role got exactly its allowlist in both modes; background mode removed nothing a role relies on.
- No role sees the core rules, because each role file sets `omitClaudeMd: true`. A role gets rules only from its
  brief or from skills preloaded at start - which is what Phase 2 adds.
- The builder needs a git repository with at least one commit, since it runs in its own worktree.
