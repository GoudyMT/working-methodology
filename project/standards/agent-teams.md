<!-- Written by kit.mjs build from rules/agent-teams.md, in the layout of the Claude Code memory docs (code.claude.com/docs/en/memory). In the kit, edit the source, not this file. In a project, fill the adapter slots here; install keeps your changes, and fold-back carries rule changes back to the kit. -->

# Agent Teams

## Multi-Agent Discipline {#multi-agent-discipline}

**Scope before you fan out.** A mode signal ("begin loop workflow", "ultra", "token cost is not a constraint") authorizes the KIND of work, never its SIZE: state the count and what each layer buys, then stop for the owner's go. "Exhaustive" means coverage (angles, files, risk classes), not re-litigating one finding. A mis-shaped run is stopped, reshaped, resumed from cache where possible. Why: orchestration gets the same gate code gets.

### The Swarm Contract (NO swarm without one) {#swarm-contract}

Before any swarm (Pre-PR Deep Sweep, Mid-Design Red-Team, any fanout) emit this table and STOP for the owner. Why: a swarm without distinct questions buys clones at full price.

| # | Role | The distinct question ONLY this role asks | Context injected | What a finding looks like | Token budget |
|---|---|---|---|---|---|

1. **Count is DERIVED, never chosen** - from the distinct risk regions.
2. **Every agent asks a question no other asks** - "what could this role find that the others structurally cannot?" No answer = a clone; delete it.
3. **Redundancy is not coverage** - an agent told to refute another's finding can only subtract; refute panels only for critical / high, max 3; below that, read and adjudicate.
4. **One slot always goes to the NOVEL lens** - a completeness critic: "what did every other role miss?"
5. **Context is per-role** - the files, rule and spec clause its lens needs; boilerplate makes generic agents.
6. **The diff is not the blast radius** - code a change was MODELLED ON ("mirrors X", copied, generalized from) gets its own role: inherited or introduced?

**Rigor = distinct questions, not agent count** (measured: ~130 refuters added nothing; one critic found the three biggest misses). **A refute panel informs; a reader adjudicates** - panels score wording, not truth; a finding a panel refuted but the code confirms is REAL. **Yield check:** findings recorded per role; a role silent across two sweeps is cut; a gap the critic keeps finding becomes a role. Every sweep and re-sweep is the owner's to approve (orchestrated: -> Agent-Team field 11).

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
8. **Rules every brief carries** (one home: every builder and checker brief tells the agent to read this block here, never a pasted copy):
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
   ```
9. **Local guards:** worktrees start from the current branch, not `main` (builders still report their base commit); permission rules + a pre-tool guard asking before any push or forge write in any spelling, proved by `<check command>`; a brief that adds a new command form for a guarded tool adds it to the check as a must-ask case first.
10. **Version + setup check:** `<minimum tool version>`. Before the first unit, check each role: model read from the run record (not the agent's claim), tool list (no outward tools), no CLAUDE.md in context, worktree base on a feature branch, a token baseline for a one-line task.
11. **Orchestrated mode:** overseer ports / lock file / worktree paths / one branch per prong; run records `<path>`; project brief `<path>`; readiness of the last prong. The orchestrator's Swarm Contract goes to the overseer, who checks it and takes it to the owner.

**Team mechanics:** briefs carry a searched collision list and the base commit and forbid remote acts; a resumed agent keeps its old role text (new rules go in the message); a worktree does not isolate git config or refs - a writing probe runs in a scratch clone, strict shell mode, top-level path proved first; integrate by cherry-pick with a blob check per file, then remove the worktree and branch and say so; after two FIX rounds the lead finishes the unit. Durable tools live in a gitignored tools folder.
