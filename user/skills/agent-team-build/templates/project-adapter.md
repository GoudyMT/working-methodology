## Agent-Team Build: Project Adapter

> The portable playbook is the `agent-team-build` skill (`~/.claude/skills/agent-team-build/`) with the
> `builder`, `checker`, `orchestrator` and `scanner` roles (`~/.claude/agents/`). This section is the only
> project-specific part. Fill every field with the user; a blank field is a question, never a guess.

1. **Adopted:** <date, by whom>. **Scoreboard lives in:** <the project's lessons file>
2. **The full gate (every step CI runs):** <command or script path>. **Green means:** <definition>
3. **A fresh worktree needs:** <shell prefix; install command; any gitignored file it must have, listed in
   `.worktreeinclude` - never secrets unless a unit truly needs them>
4. **Parallel limits:** <shared ports, servers, databases or caches, and how each running agent gets its own>
5. **Hard stops beyond the universal list:** <legal, privacy, budgets, visuals, copy, anything else>
6. **Records:** <where plan progress, session history and lessons go>
7. **Conventions:** <commit format, branch naming, comment and style rules, test rules>
8. **Rules every brief carries** (every builder and checker brief tells the agent to read this block here,
   because the agents skip CLAUDE.md; it is never pasted into a brief):
   ```
   <a compact block: privacy, security and legal limits; test rules; edit rules; style; commit format>
   ```
9. **Local guards** in the project's `.claude/settings.json` (not committed):
   ```json
   {
     "worktree": { "baseRef": "head" },
     "permissions": { "ask": ["Bash(git push *)", "PowerShell(git push *)"] }
   }
   ```
   `baseRef: "head"` makes each builder's worktree start from the current branch, not the default branch.
   - **A push guard that reads the action, not the spelling:** a PreToolUse hook on every shell tool (Bash,
     PowerShell, any terminal tool) that parses each command the way a shell does and asks the user before any push
     in any spelling (`git -C <path> push`, `send-pack`, an alias) and before any write to the code host (a `gh`
     write). The `ask` rules above match the usual spelling only, so they are a backup, not the guard.
   - In the guard, the decision comes before any side task (a log, a metric), and a side task can never fail it
     open.
   - Prove it through the real path - an agent's tool call - and read the outcome from the run record's
     `permissionDecision`, not from anyone's memory of a click. Prove every edit with its own check (a list of
     must-ask and must-pass commands), and add a must-ask case whenever a role file or brief changes an agent's
     standard form of a command the guard watches.
   - Limits: the hook's runtime must start, and a command assembled at run time is not caught.
   - Start from the working copy in the first project that adopted this method: `.claude/guard-outward.cjs` and its
     check `.claude/guard-outward-check.cjs` (ask the user for that project's path). When a second project adopts
     the method, the guard moves to one shared copy under `~/.claude/`.
10. **Claude Code version needed:** 2.1.271 or later (`omitClaudeMd`); 2.1.248 or later for a role's
    `experimental.cacheTtl` (orchestrated mode). <where the project's sessions run, and the version found there>
11. **Orchestrated mode** (only if the project uses it; `orchestrated.md`):
    - **The machine schedule:** the overseer's browser-test port; each prong's port range; the machine lock's path;
      a worktree and a branch per prong.
    - **Records:** the run-record folder; the decision log's path.
    - **The project brief:** <path> - the project's half of every orchestrator's brief: where things are (with
      where the rules block lives - it stays in field 8 only), the commands (with the per-folder tool form), the
      lock's exact take and release commands with its literal path, the known traps, the files whose values no agent
      prints, the meter.
    - **Readiness status:** the last prong against `orchestrated.md` "Readiness for more than one prong" - which
      items failed, and so whether the next prong runs alone.
