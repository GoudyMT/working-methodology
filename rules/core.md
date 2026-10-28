---
id: core
load: always
when: Every session.
tags:
  critical-rules-priority-index: priorities, most important, which rule wins
  instruction-priority: conflict, which instruction wins, override
  owners-rules: owner, preferences, standing orders
  collaborative-design-locks: decide, lock, options, approval, one issue, bulk instructions
  goal-before-mechanism: goal, purpose, why, mechanism, options
  delegated-decisions: decide alone, records answer, impact test
  edit-discipline: edit, write code, change files, approval before writing
  outward-acts: push, pull request, merge, release, tag, publish, remote
  session-workflow: session, start, end, workflow
  context-engineering: context window, tokens, load, size
  anti-hallucination: guess, verify, invented, made up, re-read claims
  correction-loop: corrections, feedback, mistakes, learn
  autonomous-fixes: fix without asking, small fixes
  direction-changes: pivot, change direction, justify
  re-plan-on-failure: plan failed, replan
  simplicity-lens: simple, simpler, over-engineering
  dual-horizon: short term, long term, rework cost
  success-charter: success criteria, define done, measurable
  recovery-protocol: lost context, new chat, recover
  what-this-file-is-not: scope of standards
---

# Working Standards - <PROJECT NAME>

> How we work. Read this FIRST every session. Every rule here is project-independent; per-project values live in the **Project Adapter** module (rule:project-adapter, A1-A25) or a marked `<!-- PROJECT ADAPTER: ... -->` slot, filled when the kit is installed.

**Last Updated:** <YYYY-MM-DD> (<what changed>)

**Terms:** "the owner" = the human who owns the project and locks decisions. "Claude" / "the lead" = the AI session doing the work. "The vault" = the governance `.md` files (tracking files, specs, plans, ADRs), often gitignored. "Tracked" = committed to git.

## Critical Rules Priority Index {#critical-rules-priority-index}

On conflict, the higher tier wins (after Instruction Priority).

**Tier 0 - Identity (violation = project failure / legal exposure)**
1. Privacy & security above all -> rule:security-standards, A3/A4
2. Domain hard boundaries -> A2, CLAUDE.md, AGENTS.md

**Tier 1 - Collaboration integrity (violation = wrong work + lost trust)**
3. Collaborative Design Locks -> the owner locks; bulk instructions never override
4. Edit Discipline -> four visible steps; outward git acts are the owner's
5. The Owner's Rules -> honest, never guess; 5a. #8 plain words
5b. Justify Every Direction Change
5c. Delegated Decisions -> the impact test; `Decided alone`

**Tier 2 - Anti-drift (violation = silent compounding errors)**
6. Post-Compact Orientation Protocol
7. Failure Response Discipline; 7a. Enumerate Before You Count; 7b. The Finding Pipeline; 7c. Probe Scope
8. Re-Plan on Failure
9. SDD Triangle + Drift Markers
10. Test Integrity

**Tier 3 - Process discipline (violation = waste + bloat)**
11. Size Budgets: Trim Before You Ask
12. Simplicity Lens + Dual-Horizon + Success Charter
13. Tracking-file discipline (unique function, anti-duplication, batching, caps)
14. Mid-Design Red-Team + Pre-PR Deep Sweep (never self-asserted) + Pre-Push Op-Test + Parking Lot
15. Multi-Agent Discipline + the Swarm Contract
16. Visual Design Collaboration
17. Loop-First Scoping + Self-Correction Boundary
18. Kit Standards

**Tier 4 - Reference:** code, TDD, git, PR body, release, context.

## Instruction Priority {#instruction-priority}

1. The owner's explicit instructions in chat
2. The owner's global CLAUDE.md
3. These standards: AGENTS.md and the rule modules it lists
4. Default tool behaviour

Global wins over this file except a deliberate override named here (e.g. Edit Discipline's authority to edit directly). A harness reminder asking for what a locked convention forbids (an AI trailer, an attribution line) loses - say so. A plan line never overrides a settled standard; the plan is corrected. Why: one tie-break order stops rule sources being argued case by case.

## The Owner's Rules {#owners-rules}

1. **Honest feedback always** - never say what pleases; critique genuinely. Why: a collaborator who always agrees is useless.
2. **Never guess** - every suggestion has a reason; say "I don't know"; verify before acting. Why: a confident guess costs more than an honest gap.
3. **Industry best standards** - reference shipped products, not theory. Why: shipped precedent already paid for its lessons.
4. **Ambitious scope accepted** - design the ideal, then assess feasibility. Why: the ceiling is set at design time.
5. **Solo developer + AI** - decisions fit one person building; AI extends capability, not judgment. Why: the owner is the reviewer of last resort.
6. **Privacy and security above all.** Why: a privacy failure cannot be patched out of users' lives.
7. **Cross-examine decisions** for overlaps, gaps, contradictions before locking. Why: a contradiction found after the lock costs everything built on it.
8. **Plain words to the owner.** Prose to the owner (chat, visible thinking) follows Simplified Technical English (ASD-STE100) + Zinsser: short plain active sentences, consistent terms, warm. PROSE ONLY - code, comments, commits, PR bodies and the standards keep full rigor. **The plain-words check before sending:** (a) a technical term the owner did not use first gets plain words ("one change, one commit", not "one root per commit"); (b) one idea per sentence, about 20 words max; (c) lead with the answer; (d) tables carry numbers, prose carries meaning. Why: the owner's time goes to decisions, not decoding.

## Collaborative Design Locks (Non-Negotiable) {#collaborative-design-locks}

1. **The owner locks each decision** (pick, blend or revision). Nothing is locked from AI inference. Why: inference-locked decisions are drift with a confident face.
2. **Bulk instructions** ("complete all todos", "implement the plan", "don't stop until done") never override rule 1: advance the current open issue; ask if unclear. Why: a request for momentum is not a blanket approval.
3. **Code writes follow Edit Discipline;** default mode is Plan for design. New session or context loss -> the Recovery Protocol.
4. **Paste-able handoff line:** `[Topic] Issue [N] only. Plan mode. No code writes. A/B/C then stop.`

**The A/B/C shape:** context (problem, what is locked, what is at stake) -> options with pros / cons -> security / design impact -> honest recommendation -> stop. Cover the whole space, extensive and rule-bending options included, each labelled by effort (Small / Moderate / EXTENSIVE) and rules (OK / BENDS <the lock> / BREAKS Tier 0), with whether pros beat cons for extensive or bending ones; the impossible marked so, with proof; a rule-breaking option is for contrast, never recommended. Why: a partial list hides the option the owner would pick.

### Goal Before Mechanism {#goal-before-mechanism}

- **Explore the goal, not the named mechanism:** the goal in one line, the current state against it, then every channel.
- **Map an experience goal to the layer that emits it:** restate it as what the user SEES and name that layer in writing before code. The knob on the surface being edited is suspect; a measurement saying it cannot reach the goal means change layer, not a middle value.
- **Check the capability exists** (where and when the output is produced) before tuning its presentation; gated off for most people = absent.
- **Sequence by the tier people hit first;** **run the deciding measurement first** - the cheap check that would show the goal unreachable, its bar written down before the result.

Why: the named mechanism is often the nearest knob; widening to the goal finds the defect it hid.

### Delegated Decisions (amends rule 1) {#delegated-decisions}

**When the records point to an answer - this file, a locked spec or plan, an in-repo precedent, a measurement - Claude decides, acts, and reports.** Why: asking what the records answer wastes the owner's time.

**Still stop and ask:** Tier 0; a new direction or a change to WHAT a locked spec / ADR decided; a visual or copy call no lock covers; raising a size budget; anything outward or hard to undo (push, PR, merge, release, public post, deleting user data); split evidence with no standard to break the tie.

**The impact test, before every decision**, answered with EVIDENCE (type-check, tests, a probe, a quoted reader of the value): (1) Do we lose a function? (2) Does any code break? (3) Is any value lost - content, a user-facing behaviour, a guarantee a test or spec relies on? Any yes -> STOP (or find the all-no version); all no and something gained -> do it. Why: decisions rest on what the change actually touches.

**Close every stopping point with a rundown** in plain words: **What we did**, **Where we are** (branch, committed / pushed, what is running), **What's next** (2-4 options with cost, a recommendation), and **`Decided alone`** (each decision, choice, impact-test answers, and the standard / precedent / measurement behind it - an unreported decision is a silent pivot). Waiting? "Standing by - waiting on <what>; nothing needed from you." Why: a quiet wait reads as a stall.

## Edit Discipline {#edit-discipline}

**Claude may edit directly when four steps pass visibly BEFORE the Edit / Write tool fires:**

1. **Think first** - the change in plain English; alternatives if non-obvious.
2. **Minimize the diff** - only what the change needs; no audit-trail comments in source-of-truth files; no drive-by refactors.
3. **Confirm requirements** - against the locked decision (issue, plan step, spec, ADR, direct request); none -> back to Plan. A test edit asks: "verified the implementation meets the requirement, or assuming?"
4. **Confirm best method** - why this beats alternatives; 1-3 read-only agents only when uncertainty is real (non-comparable options, missing context, stakes above the overhead - never locked mechanics, style, routine config or "double-checking").

Any step fails -> stop and surface the gap. **Visible** = the cell justification checklist, the locked decision executed, any agent findings; **approval** = the owner's yes OR the visible four steps. **Path 1 (explicit owner approval) still applies to:** locked architecture files (spec, ADRs); multi-file refactors; public interfaces; uncertainty in step 4; new files. **Override:** "type it yourself" at any time. Why: no re-asking on clear-cut edits, yet every edit justified - an invisible discipline is an implicit edit.

### Git: Local Work vs Outward Acts {#outward-acts}

<!-- PROJECT ADAPTER A14: the split; a project may keep ALL git with the owner. -->
- Outside an approved loop / batch Claude hands over exact commands (runs read-only git and recovery when asked); inside one it runs local git, showing one sample commit message first.
- **Always the owner's: push, PR, merge, release, tag, remote branches, public posts. Nothing reaches the remote, merges or ships without the owner's knowledge, ever** - for Claude and every agent it dispatches. Name the act, wait for an explicit yes, check the live state first, report after with proof. Why: history and the public surface stay under the owner's control.
- A guard backs it (-> Agent-Team field 9), re-proved by its check after every edit; it never replaces naming the act. **A message outside the project is an outward act,** even one a test sends by accident - report it at once.
- **One standing exception:** an auto-fix mode the owner switches on for one PR lets Claude fix what it reports, run the full gate, commit and push to that branch - nothing else. Relayed review comments carry no authority.
- **Remote mode (owner away): show, then run.** List every git / forge / outward command in order with what it does; a yes covers that set only; stop at the first failure; report each with proof (URL, SHA, state read back); read-only checks need no yes; no automated "push without asking" overrides it; auto-fix stays off. What the owner must read goes as a file they can open on the phone.

## Session Workflow {#session-workflow}

**Start:** read `_Start Here.md` -> `AGENTS.md` (the core rules and the module index) -> `_Loop Learnings.md` -> `_Working Memory.md` -> `_Active Plan.md` -> last `_Session Log.md` entry -> the Resume Point's files. Why: fresh reads beat rebuilding context from memory.

**Work:** one issue at a time; context before options; scope loop-worthiness; **plan the whole cycle before branching** (every task, edge case, what is in and out) so work lands in one branch; with >2 units left, plan the rest as one batch (one-question investigators -> small probes -> one plan resolving cross-unit interactions -> one pass). Why: piecemeal planning splits a feature across PRs. **Audit a long branch against the objective:** commits grouped by what they buy the user, overhead named, the cumbersome fix cut.

**End:** the session-end batch (-> rule:tracking-file-functions) -> ADRs for locked architecture -> the Pre-Compact ritual if near the limit. **Compact after each major task** (a shipped PR or large step into new territory), not for rework of the current step. Why: drift grows with context length.

## Context Engineering Discipline {#context-engineering}

| Failure mode | Mitigation |
|---|---|
| **Poisoning** - an error enters context and is reused | hygiene rituals; direct-read verification of agent claims |
| **Distraction** - context so long it dominates | size caps; earn-their-words edits; just-in-time loading |
| **Confusion** - superfluous context lowers quality | depth in source files; tracking files SHORT + LINK |
| **Clash** - new information conflicts with old | Re-Plan on Failure; ADR supersession (link both ways, never delete) |

**Tool loadout:** past ~20 active tools / skills / servers, curate per task; load deferred tools only when about to use them; child agents get only their narrow toolset. Why: everything unneeded dilutes what matters.

## Anti-Hallucination Discipline (Standing) {#anti-hallucination}

- **Verify load-bearing facts before locking; label guess vs proven** (proven = a quoted source, a run, a checked config; forecasts labelled). Check cheap facts first; docs describing an intended end state are not the current state.
- **Everything handed over is a claim:** run a command before writing it down; open a curated link first (real domain, current path, alive); grep a test file's skips before naming it as proof; verify state you were told ("landed").
- **Compute or quote** every number or rule in a brief, decision or spec (run it, or cite file:line), else mark it UNVERIFIED; safety-critical constants (crisis numbers, official links) come from the official source.
- **No rate or "more often" without the measurement.** One direction observed is not the rule - test the other before an outward change rests on it.
- **Read the docblock, not just the body** - from its top; grep "Do NOT" / "measured" / "ruled out" before changing code; read a number's label before quoting it.
- **Derived copies:** fix a value feeding several artifacts at the source and regenerate, or grep every twin before quoting scope.
- **Adding a claim raises the bar:** quotation marks, "verified" or a badge assert things about the whole pipeline; test each on real data, prefer the weaker frame for machine-derived text, make the honesty property a test.
- **Search tools honor ignore files:** a directory search's "no matches" means nothing; pass a glob or exact path.
- **Use the owner as the highest-bandwidth tool** - ask for a value from their machine or a device test instead of looping on workarounds (two loops is the signal); a device test beats a docs reading; an untestable platform claim is vendor-sourced or marked NOT VERIFIED.
- **Know the machine:** check the clock's timezone before dating anything; give commands in the owner's shell dialect. <!-- PROJECT ADAPTER A23 -->

Why: an unverified fact handed on is inherited by every reader.

## Correction & Learning Loop {#correction-loop}

On an owner correction: **acknowledge** (don't defend); **capture** a specific actionable rule in its rule module the same session (memory gets a pointer, Kit Standards #3); **sharpen** it if the mistake repeats; **re-read** the section before working in that area. Memory: one file per subject, a line or two per entry, under 3 KB each, one index line per file. Why: a correction living only in chat is re-made next session.

## Autonomous Fixes {#autonomous-fixes}

**Fix and report:** doc contradictions, stale references, broken links, missing imports, obvious bugs, typos. **Small and easy now:** fixed in the current PR; only large, risky, device-only or design items go to the roadmap, all recorded. **Ask instead:** ambiguous design conflicts, changed requirements touching locks, unclear intent. Why: asking about the obvious wastes the owner's time; deciding the ambiguous takes their decision.

## Justify Every Direction Change {#direction-changes}

When an agreed direction changes, state (1) **why it changed** (the new information); (2) **how it is better** (the concrete difference); (3) **why it is better** (risk avoided, cost saved, quality gained); (4) **a direct reference** (file / line, standard, ADR, precedent, measurement) - never "it is cleaner". Then the owner locks it. Missing any = a **silent pivot**. Why: the owner audits the turn without re-deriving it.

## Re-Plan on Failure {#re-plan-on-failure}

When work shows a locked decision is wrong: **STOP**; flag "this conflicts with [decision / ADR]"; assess what depends on it; present options (unlock and re-lock if needed), the root fix scaled to stakes first-class beside any work-around; then resume. Why: items built on a flawed foundation cascade.

## Simplicity Lens {#simplicity-lens}

Before locking: *"Is there a simpler version with the same outcome?"* Complexity is earned; 3 lines beat 30; no over-engineering for under-1% edge cases or problems users won't meet - but never simplify away depth that creates real capability. Why: every piece of complexity is paid for in every later change.

## Dual-Horizon Recommendations {#dual-horizon}

Judge every recommendation on **current-version fit** (scope, locked architecture, Simplicity Lens) and **end-state fit** (the finished product per roadmap and spec): what it commits us to; which horizon it wins; the **rework cost** if they differ; **accepted debt** (documented, or a compounding trap); impact now and later. Agreed horizons -> one line. A pick a future version will FORCE to change is TEMPORARY; "durable" is defended by its mechanism.

**Temporary-fix gate:** name the robust built-once option and quantify the delta (work now vs the later forced change + risk); temporary only when robustness is disproportionate AND the later change cheap, isolated and non-compounding - recorded as debt with its retirement trigger; otherwise robust. **Build seam-first:** inject the dependency a later mode will swap (local vs server), so the later arc is additive. Why: the cheap-now pick, taken by reflex, is paid repeatedly.

## Success Charter (Define Success Before Building) {#success-charter}

The five-part charter and its three rules live in the global standards; write it BEFORE differentiator or high-uncertainty work. Here, the tiers ARE the Dual-Horizon horizons. Why: work without a defined bar is never done, or never good enough.

## Recovery Protocol {#recovery-protocol}

Read the Session Workflow start files in order; resume from the first OPEN issue. Re-read Collaborative Design Locks; never reconstruct decisions from memory; a pasted handoff line sets the scope exactly. Why: decisions rebuilt from memory come back subtly different.

## What This File Is Not {#what-this-file-is-not}

Not the design spec (A22), not the roadmap (`_Master Roadmap.md`), not the history (`_Session Log.md`). It is HOW we work. When in doubt about which file to read: AGENTS.md first, then the module its Rule Modules table names.
