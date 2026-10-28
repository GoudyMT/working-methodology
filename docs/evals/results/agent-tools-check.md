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

## The guards in live agents (Phase 2, unit 3)

Run 2026-10-28 with the claude CLI 2.1.302 in the same scratch project. The guard scripts were the kit's own
files; the role definitions were the installed builder and checker, passed with `--agents` (a test copy of the
role files in the project's `.claude/agents/` ran no hooks at all; see the first row).

| Check | What happened |
|---|---|
| Role files copied into the project, run with `claude -p` | No hook ran (a logging hook wrote nothing). The docs say project-level agent hooks run only once the folder is trusted, and a `-p` session never counts as trusted; user-level role files and `--agents` definitions run them without that step. The kit installs role files user level. |
| Logging hook, agent passed with `--agents` | The hook ran on the agent's Write and logged its input. |
| Builder writes `allowed.txt` (on its unit list, then at `.kit/unit-files.txt`; the list moved to the worktree's git folder after this run, so it is never committed) in its worktree | Written ("ok" in the worktree copy). |
| Builder writes `notallowed.txt` in its worktree | Blocked by the fence: "Blocked: notallowed.txt is not in this unit's file list (.kit/unit-files.txt). Report it to the lead instead of editing it." (the message then named the old place) |
| Builder writes a file in the main checkout by absolute path | Blocked first by Claude Code's own worktree isolation, so the fence's outside-the-worktree check is proven by the unit test, not here. |
| Checker runs `git status --short`, then `echo probe > checker-probe.txt`, then stops | The write ran; at the stop the clean-tree hook blocked and named `?? checker-probe.txt`. The checker removed the file and reported it as a finding; the tree matched its start. |

- The checker guard catches a change at the stop, as designed; it does not refuse the command before it runs. Telling
  a write apart from a read in a shell command is not reliable, so that stays the role's rule plus this catch.
- The checker escalated that a read-only role ran the brief's write at all. That is the right report: the brief
  here ordered a write on purpose.

After the independent review (same day) the checker hook changed: it leaves ignored files out (test caches, and
hashing node_modules took about 2 minutes per command on a large repo; now about 0.2 seconds), blocks the stop
once and then lets it through, keys its snapshot by agent, and no longer asks for a restore, since a parallel
builder may be working in another worktree. The live run above used the earlier version.

Live rerun of the new checker hook (same day): when the brief told the checker its write was an approved test, the
stop blocked once with "Do not restore or delete anything", the checker left the file, reported it and finished.
When the brief only asked for the write, the checker refused it on its role's rule and the hook had nothing to
catch. The rerun showed the message also listed changes made before the checker started; it now names only
the new ones. Claude Code's hooks reference documents `agent_id` in the input of hooks that fire inside a
subagent, which keys the snapshot per checker.
