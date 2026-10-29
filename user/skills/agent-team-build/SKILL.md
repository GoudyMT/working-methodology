---
name: agent-team-build
description: Build an approved feature with a team of agents, in one of two modes - batch (the main session leads; Sonnet builders build each unit test-first in their own worktree; Opus checkers verify the high-risk units) or orchestrated (the main session oversees an Opus orchestrator per phase that plans and runs its own team of builders, checkers and Haiku scanners). Use only in a project whose standards contain an "Agent-Team Build" project adapter, once the user has approved the plan, or when the user runs /agent-team-build.
---

# Agent-Team Build

A portable way to ship more work per session without lowering the bar: a few roles, one user approval per
feature, machine gates instead of hand-holding, and trust that grows only on measured results. This file is
the same in every project; everything project-specific lives in the project's adapter. It has two modes: batch,
where the main session leads the team, and orchestrated, where the main session oversees a lead agent per phase
(`orchestrated.md`, in this folder).

## When to use it, and when not

**Use it** for a feature or fix batch with three or more units of real, testable work.

**Do not use it** for:
- a small or tightly coupled change: the lead does it directly (a split costs more compute than it saves);
- design work: decisions stay with the user, through the project's normal design process;
- anything the adapter lists as a hard stop, until the user has cleared it.

## Choose a mode

The plan's "Execution approach" section names the mode for each phase, with the reasoning, its source and the
expected time and cost; the user approves it with the plan. Agents are for genuinely parallel or wide work, or an
independent review; the main session builds small and medium features itself.

- **Orchestrated** for five or more units with a full pre-PR deep review (only after the readiness bar in
  `orchestrated.md` passes). Read `orchestrated.md` before planning.
- **Batch** for three or four units, or a scaled-down review.
- **The lead directly** under three units, and for any small or medium feature.
- **Several prongs at once:** each prong runs in its own session, which reports its completion back to the main
  session. Never run several prongs in one session: it slows every one of them.

Why: in the one comparison measured (on different work, so not a controlled test), the orchestrator layer cut the
main session's spend from 50.4M to 18.2M input-equivalent tokens and cost 19.0M itself - about a quarter less in
total. It also keeps the main session light (longer without a compaction), gives each phase a fresh lead, and
leaves the user free to talk to the overseer while a prong runs. On a small batch its start-up (about $1-1.50 for
each phase's lead) and the relay of every stop through the overseer outweigh what it saves. These thresholds are
judgment: each scoreboard line records its mode, and they are reset from the data after three more runs. The review
rules in "The flow" (a per-unit checker only on high-risk units, review budgets, one fix check, plan-time checks)
came from runs in both modes but have not yet run in batch mode: its next run is the one to watch.

## Before the first run in a project

The project needs an adapter: a section in its standards filled in from
[templates/project-adapter.md](templates/project-adapter.md). If there is none, draft it with the user first;
do not guess the fields. Check the local guards it names (worktree base, push asks) before the first build.

Then run a **setup check** of each role with a one-line task: read the model from the run record (the agent's
transcript), never from the agent's own claim, and check that reading with a known-positive control (a record
that should hit); confirm its tool list matches the role file's `tools` allow-list; confirm no CLAUDE.md is in its
context; for a role with a cache setting (`experimental.cacheTtl`), confirm the record's cache writes are at that
lifetime (for one hour, `ephemeral_1h_input_tokens` in the usage); and, for the builder, confirm its worktree starts
from the current branch; and confirm the guards run: a builder Write to a file off its unit list is blocked, and
the checker's stop catches a file it wrote (rule:agent-role-table; a role file copied into a project loses its
hooks); and confirm the agent canary (rule:agent-canary): the file the rule index names for
rule:agent-team-adapter ends its field 8 block with the two confirmation lines (a filled adapter copies them in from
the kit's template; without them the check is off), one agent that read its rules opens with the right line, and
one given a rules copy without its last line is stopped and closes out. Agent files edited mid-turn may only take effect on the next turn, so re-check after any
edit. Give every role a short tool list: it cuts start-up context and removes outward tools.

A passed probe proves only what it ran. Before building on one, list it beside the real use - model, tools, depth,
place, length, load, data - and mark each difference: matched; gated (a new probe passes first); or a canary (the
first small real run shows it; name what to watch). A plan built on a probe is not approved while a difference is
unmarked.

## Roles

| Role | Who | Does | Never |
|---|---|---|---|
| **Lead** | the main session (Opus) in batch mode; an `orchestrator` agent in orchestrated mode | writes the plan; briefs builders, checkers and scanners; judges findings on evidence; integrates units; runs the full gate; reports | builds units a builder should build; calls anything done without the gate |
| **Builder** | the `builder` agent (Sonnet, its own worktree) | one unit: a failing test first, the least code, a break check, a local commit, an evidence report | edits outside its file list; lowers a test; pushes; starts agents |
| **Checker** | the `checker` agent (Opus, read-only) | reviews one high-risk unit, or the fix commits: plan fit, goals, rules, test strength, claims vs evidence | edits files; passes a unit on the builder's word |
| **Scanner** | the `scanner` agent (Haiku, read-only) | lists, counts and locations across many files: a first pass the requester re-checks | judgment, design, code, writes |

In orchestrated mode the main session is the **overseer** above the lead (`orchestrated.md`, "The layers").

The agents skip the CLAUDE.md files (`omitClaudeMd`), so each brief tells the agent to READ the adapter's
"Rules every brief carries" block from the project's standards file before anything else. That block is how
privacy, legal and test rules reach every agent. It has one home: a brief points to it and never carries a
hand-pasted copy, because a pasted copy goes stale the day the rule changes.

## The flow

1. **Plan (lead).** Rank the candidate work by user value first. One plan from
   [templates/batch-plan.md](templates/batch-plan.md): the units, each with its exact files, the tests to write
   first, its done-condition, and its **collision list** - every test, caller, fixture and piece of copy the change
   can break, found by a repo-wide search including the tracked public docs, never from memory. Verify every claim
   about the code yourself, `file:line`: a roadmap box or a review finding is a claim, not a status. Settle every
   legal or source fact the work rests on now, not in review: search for every official statement of it, quote
   each, and record which reading the code keeps and why; a change to a legal date must keep any safety property the
   old code held. Measure the room left on each size budget at the base and give each unit its size-budget share,
   in its done-condition. Estimate each phase's cost in dollars. In a migration, the commit hook decides the unit
   order: what passes on both versions lands first. Name the base commit. Mark which units may run in parallel (no
   shared files, ports or servers) and which run alone. Collect every hard-stop question the plan raises in one list.
2. **Approve (user).** The user's approval of the plan starts the build; no other keyword is needed. The
   hard-stop questions are answered here, together, not one at a time mid-build.
3. **Build (builders).** One brief per unit from [templates/builder-brief.md](templates/builder-brief.md).
   Parallel units run at once, each with its own ports; small coupled units go to one builder in order, or
   to the lead.
4. **Check.** A per-unit checker runs only on high-risk units: personal data, storage or encryption, security, a
   legal date or rule, or a contract other units build on. Brief it from
   [templates/checker-brief.md](templates/checker-brief.md). A small or mechanical unit is proved by its builder's
   red-first runs and break checks: the lead re-runs one of its break checks before integrating it, and the review
   on the integrated branch covers it. Verdict: **PASS**, **FIX** (specific, with the evidence) or **ESCALATE** (a
   choice that belongs to the lead or the user). A FIX goes back to the same builder (resume it with `SendMessage`,
   so it keeps its context). At most 2 FIX rounds; then the lead finishes the unit itself or escalates.
5. **Integrate (lead).** Apply the units onto the feature branch in plan order (cherry-pick from each builder's
   branch, with a blob check per file against the builder's commit) and resolve any conflict. Every pick goes through the commit hook. Run the size checks once
   per batch, after all picks: units that each fit alone can overflow a budget together; only when a budget is over,
   bisect by re-checking per pick. A trim pass's brief
   carries an allow-list of what may be trimmed; the lead diffs each trim commit against it before keeping it, and a
   line outside it is reverted and the run stops for the user. Run the project's **full gate** - every step its CI
   runs. A red gate is a finding: diagnose with data, fix the root, one change per commit. Remove the finished
   worktrees.
6. **Review (lead and user).** The project's pre-PR review runs as ONE review wave on the integrated branch,
   scaled to stakes, under a Swarm Contract the user approves. The contract names each role, the distinct question
   only it asks, its context and what a finding from it looks like, and gives each role a token budget, a call
   ceiling and a stop rule: at most 8 findings, each under 80 words, and the first counter-example in each area,
   then move on. Findings go through the project's finding pipeline, one root per
   commit. Then ONE fix check - a single checker on the fix commits, briefed from the checker brief's fix-check
   variant - and a re-sweep of the touched areas only, once, its contract approved the same way. The two may merge
   into one checker only when the fixes cover at most 2 roots, none above low. Then
   one visual check with the user if anything visible changed. Outward acts (push, pull request, merge, release)
   wait for the user. After the user's go, the lead pushes with `KIT_PUSH_APPROVED=1` set for that one command;
   the project's git pre-push hook blocks an agent's push without it (rule:outward-acts).
7. **Record (lead).** The plan's progress, ticked with evidence; the scoreboard line, with the canary counts from
   `<git common dir>/kit-canary.log`; the rundown.

**The canary (rule:agent-canary).** The hook checks each agent message; the lead never asks for, writes or quotes
the phrase. Before using any report, check `kit-canary.log` for that agent: a `miss` voids the report whatever it
says, a "Closed out: <unit id>" note included. Start a fresh agent of the same role with the same brief plus the
rule's pick-up steps; after the second failed cycle on a unit, stop and tell the user. The hook sees the last
message of each turn, which is what the lead receives.

## Who decides

- **Builder:** details inside its unit (local names, test layout, a mechanical fix), each reported under
  "Decided alone".
- **Lead:** anything the project's records already answer - standards, a locked spec or plan, a precedent, a
  measurement - after the **impact test**: Do we lose a function? Does any code break? Is any value lost?
  Any yes means stop. The lead accepts or rejects checker findings on evidence, never by vote.
- **User:** the hard stops. Universal: privacy, security and legal limits; a new product direction or a
  change to a locked decision; a visual or copy choice no lock covers; raising a budget; anything outward
  or hard to undo (push, pull request, merge, release, publishing, deleting user data); evidence that splits
  with no standard to settle it. Plus the adapter's own list.
- **Everything else:** act, then report.

## The bar never moves

- Tests first, and every test must be able to fail: after green, break the code on purpose and see the test
  go red on an assertion, not a crash.
- Never weaken, skip, widen or swallow a test so code passes. A builder that thinks a test is wrong stops and
  says why.
- Every claim carries its evidence: a command's real output, a quoted line, a measurement. "Done" without
  evidence is not done.
- Green means every step the project's CI runs, not a subset.
- Copy commands from their source (the CI workflow, the package scripts), never from memory or a search
  excerpt.
- A limit needs an instrument: name the counter before you enforce the limit.
- A result much faster than expected is first a question about the instrument: compare its step times with a
  known-good run before trusting it.
- Agents never push, merge or publish.

## Briefs make or break the run

In practice most agent errors came from the brief, not the agent: a collision list built from memory, a base
commit not named, a rule left out. A brief is complete when a fresh reader with no chat history can do the
unit without asking: the rules block, the base commit, the exact file list, the collision list, each test
and the failure it must show, the done-condition, the exact commands (with the project's shell setup), the
ports to use, and the report format. Paste facts; never write "as discussed".

Every rule that involves deleting, moving the shell or running in another folder carries the exact command to
use, with a literal path: agents improvise where a brief is vague, and improvisation is where slips live. Read the
role files and briefs for instructions that cause a breach, not only for rules that are missing.

## Cost

A team spends more total compute than one session doing the same work: each agent reads its own context, and
each unit is briefed and checked. It buys throughput and a longer lead session. Keep the premium small: full
briefs (less re-reading), coupled units batched into one builder, tiny work done by the lead.

Measure spend from the run records (the project's meter), never the Agent result's usage line: that line is the
conversation's size, not what it spent. Measure in dollars: each model has its own price (Haiku costs about a
thirtieth of Opus per unit of token work), so a token count across models hides the cost. Cost is calls x context:
every call re-reads the whole conversation. Wide reading belongs in short-lived agents (a scanner, a builder) whose
context is thrown away; read files in ranges; prefer one script over many small calls.

## Trust grows on data

After each feature, add one scoreboard line to the project's lessons file, quality first:

```
<date> <feature> (<mode>; units N; <models>): escapes n roots (<by stage>; worst <severity>) |
after merge n | first-pass PASS n/N | FIX rounds n | user stops n (hard n, avoidable n) |
kill-switch n | $<usd> | <wall time>
```

An **escape** is a defect a later stage finds after a check passed it: the check is a checker PASS, an unchecked
unit's break checks, or the gate; the later stage is the gate, the review, CI, the user, or production. Count
escapes as roots. After 3 features, review the lines with the user and set the rules from them: loosen (more
builders at once) while escapes stay rare; tighten on any repeated escape class. Never set thresholds before the data exists. A change of model is a user decision and is noted on the
scoreboard, because trust earned on one model does not carry to another. Quality is a bar, not a quantity to
maximize: past it, more review must show what a user would notice. Compare cost only between runs that met the
bar; label any other comparison "not comparable". Lines in an older format stay as history.

## Report to the user

At every stop, in plain words: **What we did** / **Where we are** (branch, commits, what is running or
waiting) / **What's next** (options, cost, a recommendation) / **Decided alone** (each decision, its
impact-test answers, and why). When waiting, say on what. A debrief or a comparison of runs reports quality first,
then the process, then cost ([templates/debrief.md](templates/debrief.md)).

## Porting to a new project

1. Copy [templates/project-adapter.md](templates/project-adapter.md) into the project's standards and fill
   every field with the user. For orchestrated mode, also fill field 11 and write the project brief it names.
2. Set the project's local guards the adapter names, and confirm the Claude Code version it needs.
3. Run one small feature first, and review its scoreboard line before scaling up.
