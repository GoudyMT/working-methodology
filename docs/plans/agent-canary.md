# Agent Canary Check (release 1.3.0)

**Goal:** every kit agent proves it read its required rules by opening each message to its tasker with a
confirmation phrase it can only learn by reading a file itself. A miss closes the agent out safely and a fresh
agent picks up. The owner's design, 2026-10-29; decisions below are the owner's answers to five questions.

## Decided (the owner, 2026-10-29)

1. A hook checks every agent message; on a miss it tells the agent to close out without naming the phrase.
2. One phrase for all roles. A guard refuses any brief or message to an agent that contains it; it never appears in
   PR bodies, releases, commits or replies to the owner.
3. Every kit role is checked: builder, checker, scanner, orchestrator, and a new reviewer role for sweep agents.
   Built-in agent types (Explore, general-purpose) are not checked: they never read the rule files.
4. A missed report is void: a fresh agent redoes or re-checks that work before anything uses it.
5. After the second failed cycle on the same task, the run stops and the owner hears about it.
6. Also: every check is logged; the check is proved with a hit, a miss and a leak run before it is trusted.

## Design

- **One home for the phrase:** the last line of the "Rules every brief carries" block (rule:agent-team-adapter,
  field 8), which every kit-role brief tells the agent to open with Read. Role files and preloaded skills are
  injected automatically, so the phrase never goes there. The rule that describes the check (rule:agent-canary)
  never contains the phrase.
- **The check:** `user/kit-hooks/canary.cjs`, a Stop hook in every role file (SubagentStop at run time). It reads
  the phrase from the project's main checkout (through `git rev-parse --git-common-dir`, so it works from a
  worktree), checks that the agent's last message opens with it, and logs the result. A miss blocks the stop once
  with close-out instructions that never name the phrase; the next stop goes through. A project with no phrase
  line has the check off.
- **The leak guard:** the same script as a PreToolUse hook on Agent, Task and SendMessage in the project settings
  (it fires inside subagents too, so it covers orchestrators). A brief or message containing the phrase is denied.
- **Close-out:** fixed steps in rule:agent-canary. The agent stops editing and replies with its close-out note (an
  isolated agent cannot write outside its worktree, found in live run 2). The lead saves the note and a patch of
  the unfinished work to `<git common dir>/kit-handoff/<unit>/`, shared by every worktree and never committed; the
  fresh agent reads the note, applies the patch and checks the worktree against the note before it works.
- **The log:** `<git common dir>/kit-canary.log`, one JSON line per check (time, role, agent, result). The lead
  copies the counts to the scoreboard.
- **Outward text:** the PR body and release audits fail when the phrase appears.

## Progress

- [x] Failing tests (9 red first, then green): hit, miss, second stop, no phrase line, worktree lookup, log lines, leak guard (spellings),
      phrase never in the hook's own messages, one home for the phrase in the kit, role wiring, audits.
- [x] rule:agent-canary section (no phrase), field 8 phrase line, reviewer role in the role table and files.
- [x] canary.cjs (check + guard), role wiring, project settings, audits, brief templates and sweep skill.
- [ ] Live test in a scratch project: hit; miss with close-out and a fresh agent picking up; leak refused.
- [ ] Recall, independent review and one short re-check; bump to 1.3.0; push and install on the owner's go.
