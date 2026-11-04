# Orchestrated mode

Read this when `SKILL.md` "Choose a mode" picks orchestrated mode. Everything in `SKILL.md` still applies; this file
adds the layer above the team. In orchestrated mode the main session is the **overseer**. The work comes in
**prongs**: a prong is one feature or fix batch with its own branch, worktree and pull request - and its own session,
which reports completion back to the main session (never several prongs in one session) - run in three phases
(plan, build, review). Each phase of a prong is led by an `orchestrator` agent that designs and runs its own team.

## The layers

| Layer | Who | Model | Does | Never |
|---|---|---|---|---|
| User | the person | - | approves each team plan; the hard stops (privacy, security, legal, copy and visuals, budgets, downloads); push, pull request, merge, release | - |
| Overseer | the main session | Opus | briefs each orchestrator; checks its plan before the user sees it; checks every sweep contract and report for legitimacy and gaps before it reaches the user; runs the shared machine; relays questions; opens pull requests and merges with the user; writes the run record and the decision log | builds a prong's units |
| Orchestrator | the `orchestrator` role | Opus, 1-hour cache | plans its team and stops; after approval runs its phase through the team | pushes; touches the main checkout or the tracking files |
| Builder | the `builder` role | Sonnet | one unit, test-first, in its own worktree | design, copy, files off its list |
| Checker | the `checker` role | Opus | read-only review of one high-risk unit, or one fix check | edits |
| Scanner | the `scanner` role | Haiku | read-only lists, counts and locations; a first pass the requester re-checks | judgment, writes, shell |

The overseer is the only one who talks to the user, pushes, opens pull requests or merges. An optional Teacher (its
own session, the `teacher` skill) reads the decision log and explains the decisions to the user; it never edits code
or blocks the build.

**The overseer's own rules:**
- Read each orchestrator's plan before the user does: a plan written by one lead carries its blind spots into the
  next phase, and the overseer's read is the cheapest place to catch them. Re-read the plan's load-bearing claims in
  the code.
- Never declare an agent dead from one look: a background agent outlives its parent's turn, and a still-growing run
  record is a working agent. Re-read it after a few minutes and compare its size.
- Watch scripts (a monitor, a meter loop) run with an absolute working folder outside the main checkout: a tool
  started there writes its caches there.
- Answer a stop within the hour when possible (the cache clock, below).

## A fresh lead per phase

Each phase (plan, build, review) is led by a fresh orchestrator, and the plan file is the handoff: the lead writes
into it everything the next lead needs. Every call re-reads the agent's whole conversation, so a lead that lives
across phases pays for everything it ever read on every later call. Being resumed inside a phase is fine.

## The cache clock

The orchestrator role runs on the 1-hour cache (`experimental.cacheTtl: 1h`); builders, checkers and scanners stay on
the 5-minute default. A paused agent costs nothing until it is resumed. A resume inside its cache's life re-reads the
conversation at the cache price; after it, the whole conversation is paid again (measured: about $0.10 against about
$2.60 for a 320K-token lead). Leads wait on their teams, so the hour pays; short-lived agents rarely wait, and on the
1-hour price they cost more than they save. A child resumed after 5 minutes pays its whole context again - still
resume it for a FIX round (a fresh one re-reads the same files), and resume it as soon as the findings are in.

Past the hour, the overseer chooses: resume (little work left) or a fresh lead from the plan file (a large context,
much work left).

## The lead ceiling

Past about 450K tokens of context (the meter's latest context for the lead: one call's input, cache writes and cache
reads together), the overseer replaces the lead at its next stop with a fresh one from the plan file. 450K is the
largest a lead has been seen to work at; nearer the context's limit (a compaction, a lost working state) was never
observed, so the method stays inside what was measured. A fresh lead's start-up costs about $1-1.50. There is no cost
rule inside a phase: on the measured runs a mid-phase replacement would have saved at most about $0.40.

## Sweeps go through the overseer

No sweep or re-sweep starts until its Swarm Contract is cleared (rule:sweep-auto-approval). The orchestrator writes it
(what it holds: `SKILL.md` "The flow", step 6), runs `approve.mjs` on it, sends the contract and the script's output
to the overseer and stops. The overseer checks both for legitimacy and gaps: APPROVED and sound, it posts the start
notice and the orchestrator goes on; FIX THE CONTRACT, the orchestrator fixes what it named and reruns, with no user step; ASK, it takes the table and the script's reasons to the user, and logs their
yes with `--owner-yes`. The guard on reviewer agents holds the order. The
report comes back the same way: the overseer checks it, then delivers it. Two sets of eyes on every sweep.

## The kill-switch

- **Immediate stop of a prong:** any agent breaks a hard rule - a push, pull request or merge attempt; the main
  checkout touched; a write outside its file list; a tracking file edited; a download without the user's yes.
- **Pause, numbers to the user:** a phase's measured spend passes twice that phase's estimate (its pause line); two
  units exhaust their FIX rounds; the gate finds a defect a checker PASSed; agents whose output went unused.
- **On a pause the user picks:** continue, or revert - the overseer takes the prong's plan and runs it in batch mode
  (`SKILL.md`), the overseer as lead.

## The shared machine

Several prongs, or a prong and the overseer, share one computer.

- **Ports:** each running agent that runs browser tests gets its own port, one per running agent, from its prong's
  range (the project's adapter); the overseer keeps its own.
- **The machine lock:** any commit (a pre-commit hook that runs the suite), any full gate and any end-to-end or
  preview run happens only while holding the lock file the project names. Create it exclusively (if it exists, wait
  and retry), write the prong, agent, task and start time into it, run in the foreground, and release it in a
  `finally` by its literal path - never through a variable. A lock older than 60 minutes: do not delete it; report
  it to the overseer (a hung holder).
- **Before a hook or gate,** sample the top CPU processes; if the machine is busy, wait. Never raise a test's time
  limit.
- **Never stop a process you did not start.** A hung commit: stop that git commit's process tree or its hook's test
  process, never an sh.exe (a killed shell shim reads as exit 0 and lets the commit land); then check for a half-made
  commit.
- **One writer per file** across every running prong. Each Phase 1 report lists FILES OWNED and MAY CLASH WITH; the
  overseer assigns a contested file to one prong. Never write in another prong's worktree or branch.

## Records

- **The run record** (`templates/run-record.md`), one per prong run, written by the overseer at each milestone: the
  shape, the user's locks, the kill-switch, the machine schedule, the measures, the timeline, the learnings.
- **The decision log**, one per project: an entry at every decision point, two-sided (the options, what was chosen,
  the user's reasoning in their words where known, what to watch, the general idea). The overseer is its one writer.
- **Measure as `SKILL.md` "Cost" says, and record:** dollars by role, each lead's peak context, and the lock-held
  time of every commit, gate and end-to-end run - the serial share of the work, which caps what parallel prongs can
  gain.
- **The scoreboard line** (`SKILL.md` "Trust grows on data") at the end of each prong, and the debrief
  (`templates/debrief.md`).

## Readiness for more than one prong

One prong at a time until the latest single prong passes every item below; then the user makes the call. A failed
item blocks a two-prong run unless the user overrides it in writing in the decision log. Passing makes the first
two-prong run a CANARY, not a graduation. The goals behind the bar: effective execution, smart agent use, the best
outcome, and no wasted time or resources.

- **Execution.** E1: no break of a rule on the kill-switch's immediate-stop list or marked STOP in a brief, whatever
  its root (a brief is part of the method). E2: no repeat of a class in "Fixed classes" below. E3: no escape above
  low (`SKILL.md`, "Trust grows on data"), counted as roots.
- **Smart agent use.** S1: no unused agents. S2: each agent's model fits its job (the orchestrator role's model
  guide), read from the meter's model column against the team plan.
- **Outcome.** O1: the gate, CI and the project's post-merge check green, CI on its first run; the sweep's alignment
  verdict YES. O2: no fix pull request for the prong before the next prong's plan is approved, and the user's device
  check passed.
- **Not wasting.** W1: measured spend in dollars under each phase's pause line. W2: every stop that reached the user
  was a hard stop; the overseer labels each stop hard or avoidable in the run record when it happens. W3: every
  review role finished inside its contracted call cap.
- **The canary** also measures what a solo prong cannot: machine-lock contention and the serial share from the
  lock-held time; the overseer's load (stops per hour reaching the user, the overseer's compactions, its own
  dollars). It starts only when the two prongs' file lists are proven separate by lane planning (below).

**Fixed classes** (for E2). A class joins this table when its fix lands in a role or brief file; each run's record
counts its repeats.

| Class | The fix lives in |
|---|---|
| Moving the shell's location (`cd`, `Set-Location`, `Push-Location`) | `orchestrator.md` rules; the common brief's "Add to every brief as well"; a project command that once required it (a security scan run from relative paths) rewritten to absolute paths |
| Deleting by a variable path | `orchestrator.md` (a literal absolute path); the machine lock's release (above) |
| A project tool run from the wrong folder (caches written in the main checkout) | `builder.md` and `orchestrator.md` (tools run from the agent's own folder; the rule repeated in every resume message) |
| Units that fit alone overflowing a size budget together | `SKILL.md` "The flow", steps 1 and 5 (each unit's budget share; the size checks during integration) |
| Spend read from an agent's result line, not the run records | `SKILL.md` "Cost" |
| A dependency resolved by downloading first | the common brief's "Downloads resolve first" |
| Byte pressure pushing a trim into security code | `SKILL.md` "The flow", step 5 (what a trim may touch, and the lead's diff); the kill-switch (a write outside its file list) |

## Lane planning

The gate before any run of more than one prong, and the first step for choosing even one:

1. Rank the candidate work by user value and take the top 3-5. Overlap sets the schedule, never the priority.
2. For each item, list what it WRITES and what it READS: files, shared types, fixtures, stores, ports. A scanner does
   a first pass; the lead re-checks it.
3. A write-write or read-write overlap puts two items in one lane, in dependency order.
4. Items with no overlap are parallel candidates. Every lane still shares the machine lock: the best gain is
   1 / (serial share), so measure the lock-held time and shrink it before adding lanes.
5. When a unit's real file list differs from the plan, re-check the lanes.

Lane naming waits for the first plan with two lanes: a branch format is chosen then, not before. Until then, a lane's
worktree and branches are removed at integration.

## The board and the status picture

Built once 2+ lanes of long-running work are planned at the same time (the trigger), not before:
- **A lanes board:** the candidate work, the lanes, which are active or standing by, progress toward each version. It
  reads from, or is, the single source of truth - never a hand-kept second copy. Until the trigger, the run record's
  lanes table is enough.
- **A status picture:** two halves with two update rules. The plan half (the roadmap, ideas, lanes, progress per
  version) is slow and read from the records. The live half (branches ahead or behind, the latest release, CI on the
  main branch, the post-merge check, the machine-lock holder, any stopped prong) is fast and read by a local script
  at view time, never hand-typed - no model tokens per view. Each tile answers "do I need to act?"; a red tile is a
  hypothesis for the finding pipeline.
