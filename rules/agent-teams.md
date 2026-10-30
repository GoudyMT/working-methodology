---
id: agent-teams
load: on-demand
when: Before any agent batch, swarm or fan-out.
tags:
  multi-agent-discipline: agents, subagents, parallel, swarm, fan-out
  swarm-contract: many agents, roles, review agents, approval table
  patterns-and-dispatch: dispatch, sessions, prongs, worktrees
  agent-role-table: agent roles, access, tools, permissions, preloaded rules
  agent-team-adapter: agent team, builders, checkers, brief rules
  agent-canary: confirmation phrase, canary, drift check, close out, hand-off, respawn
---

# Agent Teams

## Multi-Agent Discipline {#multi-agent-discipline}

**Scope before you fan out.** A mode signal ("begin loop workflow", "ultra", "token cost is not a constraint") authorizes the KIND of work, never its SIZE: state the count and what each layer buys, then stop for the owner's go. "Exhaustive" means coverage (angles, files, risk classes), not re-litigating one finding. A mis-shaped run is stopped, reshaped, resumed from cache where possible. Why: orchestration gets the same gate code gets.

### The Swarm Contract (NO swarm without one) {#swarm-contract}

Before any swarm (Pre-PR Deep Sweep, Mid-Design Red-Team, any fanout) emit this table and STOP for the owner (or rule:sweep-auto-approval clears it). Why: a swarm without distinct questions buys clones at full price.

| # | Role | The distinct question ONLY this role asks | Context injected | What a finding looks like | Token budget |
|---|---|---|---|---|---|

1. **Count is DERIVED, never chosen** - from the distinct risk regions.
2. **Every agent asks a question no other asks** - "what could this role find that the others structurally cannot?" No answer = a clone; delete it.
3. **Redundancy is not coverage** - an agent told to refute another's finding can only subtract; refute panels only for critical / high, max 3; below that, read and adjudicate.
4. **One slot always goes to the NOVEL lens** - a completeness critic: "what did every other role miss?"
5. **Context is per-role** - the files, rule and spec clause its lens needs; boilerplate makes generic agents.
6. **The diff is not the blast radius** - code a change was MODELLED ON ("mirrors X", copied, generalized from) gets its own role: inherited or introduced?

**Rigor = distinct questions, not agent count** (measured: ~130 refuters added nothing; one critic found the three biggest misses). **A refute panel informs; a reader adjudicates** - panels score wording, not truth; a finding a panel refuted but the code confirms is REAL. **Yield check:** findings recorded per role; a role silent across two sweeps is cut; a gap the critic keeps finding becomes a role. Sweeps and re-sweeps: the owner approves, or rule:sweep-auto-approval (orchestrated: field 11).

### Patterns and Dispatch {#patterns-and-dispatch}

| Pattern | Status |
|---|---|
| Parallel read-only agents (research, exploration, verification) | OK, encouraged |
| Sequential agents passing narrow context | OK |
| Parallel code-writing agents on shared files / state | NEVER |
| Parallel builders, each in its own worktree on a file list no running unit shares, merged by the lead | OK (Agent-Team Build); shared file / port / fixture -> run in order |
| Agents editing spec / ADRs / tracking files concurrently | NEVER |

- **Modes:** parallel (one message, several Agent calls); sequential (narrow context passed on); background.
- **Model tiers:** top for high-stakes reasoning, design, security, checking; mid for coding and analysis; small for narrow high-volume scans, re-checked by the requester (moving a lead's own reading to them cost more, measured). Pin exact versions in role files; a change is the owner's call.
- **Constraints:** agents inherit permissions (a research brief names the web tools allowed; a shared browser pane is not one); they see no chat history (self-contained briefs); their claims are direct-read verified before any lock; findings come back in the final message, not files. **Own the role:** re-weigh each find with fuller context (a real miss, or an artifact of narrow scope?), never relay it as praise. Decisions, locking and design stay with the owner in the main conversation.

**Dispatch - default is direct execution:** the main session builds small and medium features; agents are for genuinely parallel or wide work, or an independent review (delegation costs more total compute). Record tokens, time and real catches; recalibrate after 3-5 dispatches.

**One session per prong:** each parallel prong runs in its own session, reporting completion to the main session. **Every plan has an "Execution approach" section** (per phase: direct, agents and their roles, or separate sessions), with the reasoning, its source and the expected time and cost, approved with the plan. Why: three prongs in one session bogged it down; agents earn their keep only on proportional value.

### Agent Role Table {#agent-role-table}

Each agent role gets only the tools its job needs and starts with the rules that bind it. This table is the one home for that; each role file in the kit's `user/agents/` must match it (a test checks), and `kit.mjs build` writes each role's rules skill from the IDs in the last column. Why: access widened in one file without the table is invisible, and an agent that skips CLAUDE.md sees no rules but its brief and what is preloaded.

| Role | Job | Tools | Denied tools | Rules at start |
|---|---|---|---|---|
| builder | Builds one unit test-first in its own worktree | Read, Edit, Write, Grep, Glob, Bash, PowerShell | WebFetch, WebSearch, Agent | edit-discipline, test-integrity, test-value |
| checker | Checks one finished unit; never edits | Read, Grep, Glob, Bash, PowerShell | Edit, Write, WebFetch, WebSearch, Agent | test-integrity, test-value, anti-hallucination, enumerate-before-you-count |
| scanner | Lists, counts and checks across files | Read, Grep, Glob | none | none |
| reviewer | Reviews one sweep role or dimension; never edits | Read, Grep, Glob, Bash, PowerShell, WebFetch, WebSearch | Edit, Write, Agent | anti-hallucination, enumerate-before-you-count |
| orchestrator | Leads one phase's team | Agent, SendMessage, ToolSearch, Read, Edit, Write, Grep, Glob, Bash, PowerShell, WebSearch, WebFetch | none | none |

The project's own filled "Rules every brief carries" block (rule:agent-team-adapter) adds the project's values and wins where it differs from the preloaded rules. Guards back the table: the builder's edit fence and the checker's clean-tree stop run as hooks in the role files, and the push guard also runs as a git pre-push hook (once `core.hooksPath` points at `.githooks`), so it holds for any AI tool that marks its shell. Role files stay user level (`~/.claude/agents/`): Claude Code skips a project-level agent file's hooks until the folder is trusted, and always in `-p`, so a project copy silently drops its guards.

### Agent Canary {#agent-canary}

Every kit-role agent opens each message to whoever started it with the phrase on the last line of field 8's block, which it finds only by opening that block with Read (role files and preloaded rules are injected, so never there). Why: an agent that skipped or lost its rules does not know it drifted.

- **The tasker never asks for, writes or quotes the phrase**, anywhere. A guard refuses a brief or message carrying it; the PR body and release audits fail on it.
- **The check is a hook:** `canary.cjs`, the Stop hook in every role file; a tool hand-back is checked at its call. A miss voids the run; the hook sends the close-out steps, never the phrase.
- **Close-out (the agent):** stop editing; commit nothing half-done; leave the changes in place; reply "Closed out: <unit id>" with a note (done, half-done, next step, files touched, last test run). (An isolated agent cannot write elsewhere.)
- **Pick-up (the lead):** save the note and the old worktree's unfinished work (`git -C <worktree> add -A -N`, then `diff HEAD --binary`) as `note.md` and `work.patch` in `<git common dir>/kit-handoff/<unit id>/`; start a fresh agent (same role and brief) plus: read `note.md`, `git apply` `work.patch`, check `git status` against the note, then continue. Nothing from a voided report is used unchecked.
- **Two strikes:** after the second failed cycle on the same unit, the run stops and the owner is told.
- **Log:** each check is a line in `<git common dir>/kit-canary.log`; the lead copies the counts to the scoreboard; `unchecked` = the check did not run; find out why. False alarms (the checker shows the agent did read) above 1 in 10: fix the wording first.
- **Not checked:** built-in agent types, which never read the rule files; sweeps use the reviewer role.

### Agent-Team Build: Project Adapter (TEMPLATE) {#agent-team-adapter}

The portable playbook is user level: the `agent-team-build` skill (both modes) and role files (`builder` - mid tier, own worktree, cannot start agents; `checker` - top tier, read-only; `orchestrator`, `scanner`). Role files skip CLAUDE.md, so field 8 rides in every brief. **The owner's approval of a batch plan starts the build.**

<!-- PROJECT ADAPTER: fill every field before the first batch. -->
1. **Adopted:** <date>. **Scoreboard:** `_Loop Learnings.md` "Agent-team scoreboard".
2. **Full gate:** `<command>`, copied from a full read of every CI workflow and re-diffed when one changes; `<worktree flag>`, `<port flag>`. Green = every step exit 0 in `<summary log>`. Only the lead runs it, after integration, preview servers stopped.
3. **Fresh worktree:** `<shell prefix>` then `<frozen-lockfile install>`; confirm on the first run that the unit suite passes there; needed gitignored files go in `.worktreeinclude` (never secrets).
4. **Parallel limits:** `<shared ports, browsers, databases, fixtures>` and how the lead assigns them.
5. **Extra hard stops:** Tier 0 (`<A2>`); visual / copy changes without a locked wireframe or copy line (Visual Checkpoint after <= 3 visual units); any budget raise; spec / ADR changes; the Pre-PR Deep Sweep under a Swarm Contract before any PR.
6. **Records:** the plan's `## Progress`, ticked with evidence (the plan file is the progress record); `Decided alone` in every rundown; tracking files at session end; lessons and the scoreboard line in `_Loop Learnings.md`.
7. **Conventions:** branch first; commit format; Test Integrity; comment philosophy; graduated lessons. Inside a batch the lead and builders run the test runner and local git; builders share a commit lock; Edit Discipline's steps live in the batch plan and builder reports.
8. **Rules every brief carries** (one home: every kit-role brief tells the agent to read this block here, to its last line, never a pasted copy):
   ```
   <PROJECT NAME> - RULES EVERY AGENT FOLLOWS
   Privacy + security: <data boundary>; <baseline>; no secrets in client code or commits; never print
     values from <secret files>.
   Domain boundaries: <A2>.
   Tests: red first; never weaken, skip, widen, delete or swallow a test; prove every new test can fail
     (break -> red on an assertion -> restore). <strict compiler flags that apply to tests>.
   Test value: each test guards a real use or real failure through its seam; no padding, no restating
     code, no second proofs. Name the use for any test beyond the brief.
   Before the first edit: search the whole repo (source AND tests, E2E too) for everything the change
     invalidates - value, bare name, regex selector forms; let the type-check find typed users; read
     every test of a changed component.
   Edits: the Edit tool only - never sed, heredocs or redirection into source; re-read after a formatter;
     build non-ASCII at run time.
   Errors: static opaque codes; detail to <safe logger>.
   CI-only gate: run <scanner> on each changed file by absolute path before reporting.
   Style: ASCII only; comments explain WHY for a reader with only the code - no labels, no history, no
     commented-out code; constants UPPERCASE.
   Commits: one line `type: subject`, imperative, lowercase, no period, no body, no trailer, no AI
     attribution; never --no-verify.
   Budgets: never raise a limit; report an overage with the measured shortfall.
   Visuals + copy: change only what the plan specifies from a locked wireframe or copy line.
   Confirmation (rule:agent-canary): a message to whoever started you that does not open with the words
     after "with:" below is void; if you see you left it out, close out as that rule says.
   Confirmation phrase: open your first message to whoever started you, and every message after it, with: Nil Satis Nisi Optimum
   ```
9. **Local guards:** worktrees start from the current branch, not `main` (builders still report their base commit); permission rules + a pre-tool guard asking before any push or forge write in any spelling, proved by `<check command>`; a brief that adds a new command form for a guarded tool adds it to the check as a must-ask case first.
10. **Version + setup check:** `<minimum tool version>`. Before the first unit, check each role: model read from the run record (not the agent's claim), tool list (no outward tools), no CLAUDE.md in context, worktree base on a feature branch, a token baseline for a one-line task.
11. **Orchestrated mode:** overseer ports / lock file / worktree paths / one branch per prong; run records `<path>`; project brief `<path>`; readiness of the last prong. The orchestrator's Swarm Contract goes to the overseer, who checks it and takes it to the owner.

**Team mechanics:** briefs carry a searched collision list and the base commit and forbid remote acts; a resumed agent keeps its old role text (new rules go in the message); a worktree does not isolate git config or refs - a writing probe runs in a scratch clone, strict shell mode, top-level path proved first; integrate by cherry-pick with a blob check per file, then remove the worktree and branch and say so; after two FIX rounds the lead finishes the unit. Durable tools live in a gitignored tools folder.
