# Working Standards - <PROJECT NAME>

> How we work. Read this FIRST every session. The general core of an AI-assisted working methodology: every rule here is project-independent. Values that differ per project live in the **Project Adapter** at the end (fields A1-A25) or in a marked `<!-- PROJECT ADAPTER: ... -->` slot; fill them when the kit is installed.

**Last Updated:** <YYYY-MM-DD> (<what changed>)

**Terms:** "the owner" = the human who owns the project and locks decisions. "Claude" / "the lead" = the AI session doing the work. "The vault" = the governance `.md` files (tracking files, specs, plans, ADRs), often gitignored. "Tracked" = committed to git.

---

## Critical Rules Priority Index

The higher the tier, the worse the failure when the rule breaks. On conflict, the higher tier wins (after Instruction Priority).

**Tier 0 - Identity (violation = project failure / legal exposure)**
1. Privacy & security above all -> "Security Standards", A3/A4
2. Domain hard boundaries -> A2, CLAUDE.md, AGENTS.md

**Tier 1 - Collaboration integrity (violation = wrong work + lost trust)**
3. Collaborative Design Locks -> one issue at a time; the owner locks; bulk instructions never override
4. Edit Discipline -> four visible steps before any edit; outward git acts are the owner's
5. Honest, evidence-based, never guess -> "The Owner's Rules"
5a. Plain words to the owner -> "The Owner's Rules" #8
5b. Justify Every Direction Change -> no silent pivots
5c. Delegated Decisions -> decide what the records answer, after the impact test; report in `Decided alone`

**Tier 2 - Anti-drift (violation = silent compounding errors)**
6. Post-Compact Orientation Protocol -> fresh reads, anti-hallucination clause
7. Failure Response Discipline -> triage, then diagnose with data
7a. Enumerate Before You Count -> read every match; report the false-positive rate
7b. The Finding Pipeline -> a finding is a hypothesis; truth = reproduce it OR quote it
7c. Probe Scope -> a passed probe proves only what it ran
8. Re-Plan on Failure
9. SDD Triangle + Drift Markers
10. Test Integrity

**Tier 3 - Process discipline (violation = waste + bloat)**
11. Size Budgets: Trim Before You Ask
12. Simplicity Lens + Dual-Horizon + Success Charter
13. Tracking-file discipline (unique function, anti-duplication, batching, caps)
14. Mid-Design Red-Team + Pre-PR Deep Sweep (MANDATORY, never self-asserted) + Pre-Push Op-Test + Parking Lot triage
15. Multi-Agent Discipline + the Swarm Contract
16. Visual Design Collaboration
17. Loop-First Scoping + Self-Correction Boundary

**Tier 4 - Reference:** code, TDD, pre-commit, branching, PR body, release, context engineering.

---

## Instruction Priority

1. The owner's explicit instructions in chat
2. The owner's global CLAUDE.md
3. This file
4. Default tool behaviour

Global standards win on conflict, except where this file names a deliberate project override (e.g. Edit Discipline's authority to edit directly). Why: one tie-break order stops rule sources being argued case by case.

---

## The Owner's Rules

1. **Honest feedback always** - never say what pleases; critique genuinely. Why: a collaborator who always agrees is useless.
2. **Never guess** - every suggestion has a reason; say "I don't know"; verify before acting. Why: a confident guess costs more than an honest gap.
3. **Industry best standards** - reference shipped products, not theory. Why: shipped precedent already paid for its lessons.
4. **Ambitious scope accepted** - design the ideal, then assess feasibility. Why: the ceiling is set at design time.
5. **Solo developer + AI** - every decision fits one person building; AI extends capability, not judgment. Why: the owner is the reviewer of last resort.
6. **Privacy and security above all.** Why: a privacy failure cannot be patched out of users' lives.
7. **Cross-examine all decisions** for overlaps, gaps, contradictions before locking. Why: a contradiction found after the lock costs the lock plus everything built on it.
8. **Plain words to the owner.** All prose to the owner (chat, visible thinking) follows Simplified Technical English (ASD-STE100) + Zinsser (simplicity, brevity, clarity, humanity): short plain active sentences, consistent terms, warm. PROSE ONLY - code, tests, comments, commits, PR bodies and the standards keep full rigor. **The plain-words check before sending:** (a) every technical term the owner did not use first gets plain words ("one change, one commit", not "one root per commit"); (b) one idea per sentence, about 20 words max; (c) lead with the answer; (d) tables carry numbers, prose carries meaning. It binds hardest in loop summaries, relayed agent reports and decision prompts. Why: the owner's time goes to decisions, not decoding.

---

## Collaborative Design Locks (Non-Negotiable)

1. **The owner locks each decision** (pick, blend or revision). Nothing is locked from AI inference. Why: inference-locked decisions are drift with a confident face.
2. **Bulk instructions** ("complete all todos", "implement the plan", "don't stop until done") never override rule 1: advance the current open issue; ask if unclear. Why: a request for momentum is not a blanket approval.
3. **Code writes follow Edit Discipline.**
4. **New session / context loss:** read the Session Start files; resume from the first open issue; never recreate decisions from memory.
5. **Default mode is Plan** for design; once locked, edits proceed under Edit Discipline; "type it yourself" overrides any time.
6. **Paste-able handoff line:** `[Topic] Issue [N] only. Plan mode. No code writes. A/B/C then stop.`

**The A/B/C shape:** context (problem, what is locked, what is at stake) -> options with pros / cons -> security / design impact -> honest recommendation -> stop. Label each option's effort (Small / Moderate / EXTENSIVE) and whether it keeps, bends or breaks Tier 0. Restate the owner's goal before narrowing to the mechanism a request names. Why: the named mechanism is often the nearest knob, not the right layer.

### Delegated Decisions (amends rule 1)

**When the records already point to an answer - this file, a locked spec or plan, an in-repo precedent, a measurement - Claude decides, acts, and reports.** Why: asking what the records answer costs the owner's time and teaches nothing.

**Still stop and ask:** Tier 0; a new product direction or a change to WHAT a locked spec / ADR decided; a visual or copy call no wireframe or lock covers; raising a size budget; anything outward or hard to undo (push, PR, merge, release, public post, deleting user data); split evidence with no standard to break the tie.

**The impact test, before every decision**, each answered with EVIDENCE (type-check, tests, a probe, a quoted reader of the value): (1) Do we lose a function? (2) Does any code break? (3) Is any value lost - content, a user-facing behaviour, a guarantee a test or spec relies on? Any yes -> STOP (or find the all-no version). All no and something gained -> do it. Why: decisions rest on what the change actually touches.

**Close every stopping point with a rundown** in plain words: **What we did** (outcomes), **Where we are** (branch, committed / pushed, what is running or waiting), **What's next** (2-4 options with cost and why, and a recommendation), plus `Decided alone`. Waiting with nothing to do? Say "Standing by - waiting on <what>; nothing needed from you." Why: a quiet wait reads as a stall.

**`Decided alone` section** at the end of every workflow, loop or task: each decision, the choice, its impact-test answers, and the standard / precedent / measurement it rests on. Why: an unreported decision is a silent pivot.

---

## Visual Design Collaboration

**Covers** how the product LOOKS: layouts, navigation, typography in use, component visuals, brand, themes. **Not** accessibility primitives (the a11y standard), token values (design-system foundation via TDD), or performance-driven CSS (performance gates).

**The rule: visual decisions are collaborative, never unilateral.** (1) Surface what is about to be locked; (2) gather 2-3 shipped references that solve it differently; (3) discuss goal and trade-off; (4) the owner locks - recorded in the spec's visual section or an ADR; (5) then implement. Why: visual identity is differentiation and cannot be assembled from defaults.

- **Wireframe FIRST.** Every visual decision is made from a rendered wireframe, never from prose options. Why: text hides what a picture shows.
- **Inside the real screens.** Draw each option in the real app (nav, surrounding content, placement) with the tap-through flow, not floating component cards. Use real-length text at the narrowest width; read the shipped component's responsive rules first; diff mockup copy against the shipped component before locking. Why: placement, discoverability and overflow show only in context. <!-- PROJECT ADAPTER A21: mockup location, widths, themes. -->
- **Locatable proof or not decided.** A visual is decided only with a mockup, a spec section or an explicit lock to point at; otherwise stop, surface, mock. Do not mock an already-locked design.
- **Pre-PR visual verification.** Before a PR that changes anything visible: confirm it works, then give the owner step-by-step checks (states, every theme, narrow width, click + keyboard) and what changed vs what is intentionally unchanged. Never "it should look right". Why: tests prove structure; only a look proves appearance.
- **Show live; leave no temp files.** Prefer a live browser pane on a dev server. Every screenshot, scratch script, log, backup or draft is deleted once it has served. <!-- PROJECT ADAPTER A21: how visuals reach the owner when away from the machine. -->
- **Interaction-pattern consistency.** First find the pattern the app already uses for the same CLASS of action and match it (typically inline-expand for in-context tweaks, modal for heavy / destructive / content moments). Why: two feels for one kind of job reads as awkward.
- **Plan placeholders are NOT locked.** Surface a plan's placeholder visuals for confirm or revise; "plan defaults are fine" locks them (one Session Log line).
- **Visual code takes Path 1** (explicit approval). Path 2 still covers tokens, visual-behaviour tests, non-visual config, appearance-preserving refactors.

---

## Edit Discipline

**Claude may edit directly when four steps pass visibly BEFORE the Edit / Write tool fires:**

1. **Think first** - the change in plain English; alternatives if non-obvious.
2. **Minimize the diff** - touch only what the change needs; no audit-trail comments in source-of-truth files; no drive-by refactors. The file IS the decision.
3. **Confirm requirements** - against the locked decision (issue, plan step, spec, ADR, direct request); none -> back to Plan. For a test edit: "have I verified the implementation meets the requirement, or am I assuming?"
4. **Confirm best method** - why this beats alternatives; 1-3 read-only agents only when uncertainty is real.

Any step fails -> stop and surface the gap. Why: no re-asking on clear-cut edits, yet every edit justified.

- **Visible:** the cell justification checklist (global standards), the locked decision executed, any agent findings. Why: an invisible discipline is an implicit edit.
- **Agents** only for genuinely non-comparable options, missing context, or stakes above the overhead - never for locked mechanics, style, routine config or "double-checking".
- **Approval** = the owner's yes in chat OR the visible four steps.
- **Path 1 (explicit owner approval) still applies to:** files holding locked architecture (spec, ADRs); multi-file refactors; public interfaces; uncertainty in step 4; new files.
- **Override:** "type it yourself" at any time. Why: the discipline serves the owner's workflow.

### Git: Local Work vs Outward Acts

<!-- PROJECT ADAPTER A14: the split; a project may keep ALL git with the owner. -->
- Outside an approved loop / batch: Claude hands over exact commands; runs read-only git and recovery when asked.
- Inside an approved loop / batch: Claude runs local git (add, commit, worktree, cherry-pick) - a scoped override.
- **Always the owner's: push, PR, merge, release, tag. Nothing reaches the remote, merges or ships without the owner's knowledge, ever.** Why: history and the public surface stay under the owner's control.
- Back it with a guard (permission rules + a pre-tool hook asking before any push or forge write in any spelling), proved by a check script after every edit to it.
- Remote mode (owner away): list every git / forge command; run only on their yes.

---

## Session Workflow

**Start:** read `_Start Here.md` -> `_Working Standards.md` -> `_Loop Learnings.md` -> `_Working Memory.md` -> `_Active Plan.md` -> last `_Session Log.md` entry -> the Resume Point's files. Why: fresh reads beat rebuilding context from memory.

**Work:** one issue at a time; context before options; scope loop-worthiness; branch first; **plan the whole cycle before branching** (every task and edge case mapped so work lands in one branch; with >2 units left, plan the rest as one batch - why: piecemeal planning splits a feature across PRs); discuss, lock, move on.

**End:** Session Log entry -> Working Memory -> Master Roadmap boxes -> Active Plan -> ADRs for locked architecture -> the Pre-Compact ritual if near the limit. **Compact after each major task** (a shipped PR or large step). Why: drift grows with context length.

---

## Tracking File Size Caps (Hard Limits)

Measured caps; over a cap -> compress BEFORE proceeding.

| File | Section | Cap |
|---|---|---|
| `_Master Roadmap` | per-version entry | <= 80 words / 4 lines |
| `_Working Memory` | Last Session / Current Phase / Resume Point | <= 50 / 60 / 40 words |
| `_Working Memory` | Session Index entry | <= 60 words |
| `_Active Plan` | Status / component row | <= 60 / 30 words |
| `_Session Log` | per entry | the template |
| `_Working Memory` | **whole file** | <= 60 lines (10 newest index entries) |
| `_Active Plan` | **whole file** | <= 70 lines |
| `_Session Log` | **whole file** | <= 10 sessions (2 full + 8 compressed, <= 60 words each) |
| `_Loop Learnings` | **whole file** | open lessons only |

**Whole-file rows are checked every time** - per-line caps do not stop a file tripling, and what no session owns no session checks. An OVER row is fixed by MOVING the oldest content to `_Archive/` (every moved line verified there), never deleting. Depth lives in specs, ADRs, plans and code; tracking files hold SHORT summary + LINK.

---

## Session Log Compression Pattern

- **Latest 2 sessions** full; **older** compressed to 1-2 lines + pointers.
- **Atomic step:** writing the new entry and moving the now-third entry to `_Archive/_Session Log Archive.md` (leaving its summary + pointer) are ONE edit.
- **Invariant:** at most TWO `## Session` entries carry `###` subsections; checked at session end AND at orientation (grep `^### `).
- **Format:** `## Session N - <topic> (YYYY-MM-DD)` + `<summary>. -> <pointers> | full detail: <archive link>`.
- **Compression MOVES, never deletes.** A gitignored vault has no git history; "git has it" is false. Before relying on a safety net named in a rule, confirm it exists for THIS file.

Why: the log's job is narrative + latest state; old detail is noise once source-of-truth files hold it.

---

## Per-Tracking-File Unique Function + Anti-Duplication

| File | Unique job | Never contains |
|---|---|---|
| `_Session Log.md` | narrative: WHAT happened WHEN; commit hashes once | checkboxes, next actions, decision lists |
| `_Working Memory.md` | dashboard: WHERE we are | task breakdowns, rationale, risk register |
| `_Master Roadmap.md` | task status: checkboxes ONLY | hashes, rationale, next actions, descriptions |
| `_Active Plan.md` | the exact next action | history, task lists, rationale |

**Anti-duplication:** content in a source-of-truth file (spec / ADR / plan / git log / code) is pointed to, never restated; content needed in several tracking files lives inline only in its unique-function file. Why: one item in eight places is eight places to go stale.

**Session-end batch, in order:** Session Log (the depth) -> Working Memory (Last Session + one index line) -> Master Roadmap (boxes only) -> Active Plan (status + exact Resume Point). About 5-10 changed lines beyond the log entry.

**Self-audit before writing:** in a source-of-truth file? -> pointer. In another tracking file this batch? -> inline only in the unique-function file. Under the cap? Any "write it anyway" -> STOP.

### Status Files Rot Silently

Drift concentrates in sections organized as CATEGORIES (security, testing, CI, a11y, launch readiness), because the session-end batch walks the work and no session owns a category.
1. **Never mix TASKS and acceptance CRITERIA in one list.** Tasks are checked by the session doing them; criteria are confirmed by an AUDIT at a gate. Label each. Why: criteria filed as tasks are orphans.
2. **Stamp `Last verified against the codebase: YYYY-MM-DD`.** An unaudited box is a CLAIM. Why: no grep finds "code disagrees with checkbox"; honest staleness substitutes for the missing gate.
3. **No descriptions in a status file.** Fresh narrative makes rotting boxes read as current.

Re-verify the current version's boxes at each Pre-PR Deep Sweep (dimension 6) and at the launch gate. Why: a record with a known error rate gets replaced by memory, which never announces its own.

---

## Tracking-File Batching

Update tracking files ONLY at a real milestone, session end (owner declares), the owner's request, or a completed plan phase - never after each edit, "just to be safe", or mid-task. **Always immediate:** source-of-truth files (they are the work), broken references that hurt recovery, new rules here, owner-requested edits. Why: per-step bookkeeping burns context and kills momentum on state that changes minutes later.

**Source-of-truth edits earn their words:** the load-bearing change; one link to the canonical pattern; no audit metadata; no restating; no redundant citations. Why: a citation that changes nothing a developer does is noise.

---

## Engineering Decisions Documents (Optional, Public Repos)

One outward doc per major phase telling WHY its tools and conventions were chosen: Overview / Stack at a Glance / Decisions and Reasoning (per tool: what, why, alternatives, trade-offs, ADR link) / How the Pieces Fit / Standards Adopted / Further Reading / Revision Notes. A hard word cap counted by ONE named tool; trim narrative, never a technical fact; honest trade-offs; no AI tool references; link, don't restate; polish at section end only. Why: unwritten judgment is invisible. <!-- PROJECT ADAPTER A22: location, cap, counter, public style. -->

---

## Context Engineering Discipline

| Failure mode | Mitigation |
|---|---|
| **Poisoning** - an error enters context and is reused | hygiene rituals; direct-read verification of agent claims |
| **Distraction** - context so long it dominates | size caps; earn-their-words edits; just-in-time loading |
| **Confusion** - superfluous context lowers quality | depth in source files; tracking files SHORT + LINK |
| **Clash** - new information conflicts with old | Re-Plan on Failure; ADR supersession (link both ways, never delete) |

**Tool loadout:** past ~20 active tools / skills / servers, curate per task; load deferred tools only when about to use them; child agents get their narrow toolset only. **Just-in-time:** read the minimum for the current task. Why: everything unneeded dilutes what matters.

---

## Pre-Compact and Post-Compact Hygiene Ritual

**Keyword `begin pre-compact`** (standing) triggers the Pre-Compact Closeout: (1) capture every style / format / workflow correction durably; (2) the scan below; (3) the session-end batch; (4) git verify - branch, HEAD, clean, ahead / behind, and REMOTE branches (merged and equal to its squash -> delete; open or no PR -> report); (5) the rule sort for the kit (scan step 5b); (6) the handoff message.

### Pre-Compact Scan

0. **ASCII scan** of this session's edits (unicode arrows, curly quotes, em dashes, any non-ASCII byte).
0b. **Comment-label scan** of every source file touched: phase / task / session / ADR labels in comments get reworded to the MECHANISM. Emit pass / fail - a check not shown did not happen.
1. **Anti-duplication scan** - hashes in the Session Log only, locks in ADRs only, next actions in the Active Plan only, statuses in the Roadmap only.
2. Audit the Roadmap, the dashboard, the Active Plan and the current log entry against caps and template.
3. **Size-cap table** `| item | words | cap | status |` - the four whole-file rows + every capped line touched - counted, never estimated; fix OVER rows and re-emit all-`ok`. Satisfied only when the all-`ok` table is shown.
4. **Loop-learnings check** - this session's lessons captured; the handoff names open lessons + any regression.
5. **Temp files** that have served are deleted.
5b. **Rule sort for the kit (every project, standing):** list each rule, standard or workflow change made this session (standards, skills, agent roles, working-style memory) and tag it `project-only` or `portable`. Portable ones go to the methodology kit's fold-back (`/methodology-kit fold-back`), with the owner, before or right after the compact; project-only ones stay in the project. Emit the tagged list; a session with none says "no rule changes". Why: methods improve inside projects; without this step the improvement stays in one project.
6. Generate the handoff.

### Post-Compact Orientation Protocol (MANDATORY first action)

Why: the recurring drift is treating reminders and the summary as a re-read, then claiming "I just re-read".

1. **Fresh Read calls** on every file in the handoff's Reading Order. NOT substitutes: system reminders inlining files (stale), the compaction summary (a paraphrase), auto-imported `@file` content (instruction files only), memory.
2. **Visible checklist:**
   ```
   Post-Compact Orientation Protocol:
   [x] _Start Here.md - reading order matches handoff
   [x] _Working Standards.md - Edit Discipline + this protocol intact
   [x] _Loop Learnings.md - N open lessons, 0 recurred
   [x] _Working Memory.md - Last Session = N, Resume Point = X (matches handoff)
   [x] _Active Plan.md - Resume Point = Y (matches handoff)
   [x] _Session Log.md latest entry - last session was Z (matches handoff)
   [x] <plan / spec / ADR named by the Resume Point>
   ```
   Each line confirms a match or flags a discrepancy.
3. Anti-duplication spot-check (2-3 items). 4. ASCII scan. 5. Size-cap table, all-`ok`. 6. Log compression check. 7. **Milestone-sweep check:** a sub-project marked COMPLETE without its sweep box, or a branch near a PR without a current deep-sweep report -> flag and sweep first. 8. **Branch check:** implementation work on `main` -> branch before the first tracked edit. 9. **Confirm working mode + first action** with the owner before anything beyond Read (default Plan).

**Anti-hallucination clause:** "I just re-read", "state verified", "the standards confirmed" are FORBIDDEN unless the Read tool ran this session for each file named. No visible checklist = no orientation = no source-of-truth work.

### Handoff Message Structure

One self-contained message: any command the owner must run first in its own code block, then one copyable text block:

```
# <PROJECT NAME> - Continuation Handoff

## REQUIRED FIRST ACTIONS
Run the Post-Compact Orientation Protocol in `_Working Standards.md`: fresh `Read` calls on every file in the
Reading Order (not this summary); visible `[x]` checklist; anti-duplication + ASCII scans + size-cap table;
confirm working mode + first action with the owner before any edit or dispatch.
This handoff is a CACHE; the vault files are the source of truth.

## Working Mode: Plan (default)

## State Snapshot
- Current component / version:
- Locked this session: (1 line each + link)
- Open issues:
- Git: (branch, HEAD, pushed or not, open PRs)

## Newly-Established Working Standards

## Critical In-Flight Context (do NOT lose)
- Decisions awaiting the owner:
- Corrections caught mid-session:

## Reading Order (mandatory, in order)
1. _Start Here.md  2. _Working Standards.md (esp. new rules)  3. _Loop Learnings.md  4. _Working Memory.md
5. _Active Plan.md  6. Last Session Log entry  7. (spec / ADR / plan for the next issue)

## Next Step (REQUIRED)
- What:  - Why:  - Source: Active Plan Resume Point; Roadmap milestone advanced
- Deviation (if any): what changed from the plan-of-record + why

## Anti-Hallucination Discipline
- Every claim verified by file read; vault state wins over this handoff.
```

---

## Anti-Hallucination Discipline (Standing)

- **Verify load-bearing facts before locking; label guess vs proven.** Run a command before writing it down; open a link before handing it over.
- **Compute or quote** every number or project rule that goes into a brief, decision or spec (run it, or cite file:line); mark the unchecked UNVERIFIED.
- **No rate or "more often" without the measurement**; say "not measured" or measure first.
- **Read the docblock, not just the body** - grep for "Do NOT" / "measured" before changing code.
- **Use the owner as the highest-bandwidth tool** - ask for a value from their machine or a device test instead of looping on workarounds; a device test beats a docs reading.
- **Know the machine:** check the clock's timezone before dating anything; give commands in the owner's shell dialect. <!-- PROJECT ADAPTER A23 -->

Why: an unverified fact handed on is inherited by every reader.

---

## Code Standards

Additive to the global standards. Stack, naming, linters and import order live in A6/A7.

- **Size targets:** functions <= 50 lines (100 = refactor signal); UI components <= 250; files <= 500. Why: small units fit context, test easier, reason easier.
- **Comments:** WHY on first occurrence; one-line reminder on repeats; nothing on the obvious; never every line.
- **Self-contained comments:** sense to a reader with ONLY the code - no plan / finding / ADR / session / task labels, no history, no restating code. Why: labels add nothing for a cold reader and cost tokens.
- **Comment out, prove, then delete:** comment out code or data believed unneeded; prove nothing uses it (type-check, tests, probe, build); DELETE it in the same piece of work (git keeps it; needed reference material moves to docs first). Only exceptions: a marked placeholder or reminder saying what and why it waits (`// TODO: <what> - <why not yet>`). Why: a comment that makes a reader ask "what is this for?" is debt.
- **Docstrings:** Google-style on public functions / classes (description, typed Args, Returns, Raises; Example when non-obvious); helpers get a one-liner.
- **ASCII only** in every file (`->`, straight quotes, ` - `). Build non-ASCII at run time from code points; never type an escape into a tool parameter (it may arrive decoded); scan every edited file before commit and at closeout. Why: invisible characters break diffs, greps and absence checks.
- **Configuration constants** UPPERCASE at the top; no magic numbers in bodies.
- **Errors** throw static opaque codes (`throw new Error('E_SOMETHING')`), never interpolated input; detail goes to the safe logger. Why: input in an error is an injection and leak path. <!-- PROJECT ADAPTER A13 -->
- **Script output:** `"=" * 60` dividers; TITLE IN CAPS header block; 4-space detail indent; `# Step N:` in code and `[N/M] ...` in output.

### Size Budgets: Trim Before You Ask

Budgets are constraints we set OURSELVES so only what is necessary ships. When a change would exceed one, the order is fixed:
1. **Look for bloat first** in the over-budget bucket (dead guards, duplicated logic, values never read, eager code needed on demand) and MEASURE each saving - even for a small overage.
2. **Prove each removal changes nothing** (the impact test): one trim per `perf:` commit through the full gate; a probe where no test can observe it; a trim that breaks anything is reverted. **Security code is never a trim candidate:** the trim brief is an allow-list of files and functions, and every trim commit is diffed against it.
3. **Only then request room** with the measured shortfall, what was ruled out, and the proposed number; the owner decides. **Moving bytes between budgets is a request too.**

Never raise a limit to make a run pass, never before steps 1-2. Keep a margin larger than CI's build-to-build drift. Why: a budget that bends on request is not a budget. <!-- PROJECT ADAPTER A12 -->

---

## Test-Driven Development (TDD)

**Mandatory for every feature and bugfix:** RED (a failing test for the smallest behaviour, watched failing for the right reason) -> GREEN (minimum code) -> REFACTOR (tests stay green). Never defer the testable slice. Why: a test written after the code tests the code, not the requirement.

- **Coverage targets:** pure logic - every branch a caller or bad input can reach; UI - render + interaction + state; boundaries - contract + mocked integration; critical paths - E2E. Coverage is a signal, never a goal.
- **Exercise failure paths:** force failure / recovery branches and assert the restore.
- **Verify the output artifact, not just the run:** diff real input -> output and search it for every form of loss. Why: a green run can ship destroyed content.
- **First, per component:** acceptance criteria as test specs, edge cases, failure modes, then tests, then code. **Fixtures look like the data** - derive them from real identity rules and samples. Why: tidy fixtures hide the cases worth testing.
- **Layout:** tests beside source (`<source>.test.<ext>`), E2E in `tests/`. <!-- PROJECT ADAPTER A8 -->

### CI Gate

**"Green" = every step of every CI workflow file**, not a remembered subset. Run the FULL local gate before every PR (the hook is a subset), read each exit code, ship CI / config changes inside the PR that needs them, and re-run the dependency audit right before handing over merge commands. Why: a remembered subset is how red mains happen. <!-- PROJECT ADAPTER A9/A10 -->

### Test and Review Cadence (how often, never how strict)

Why: running the whole suite on every commit and re-running every check after each small fix spends most of a session's wall time without catching more. The test rules never change - test first, break check, full gate before every PR; only the cadence does.

- **Commit hook:** lint, type check and only the tests related to the staged files. The full suite runs at each phase's full gate and in CI.
- **Full gate:** once at the end of each phase, not after every fix batch, and always before a PR.
- **Size budgets:** measured once per integration batch, not after each pick; bisect only when a line is over.
- **Unchanged builder commits:** a commit carried over with every file proved byte-equal skips the hook re-run (bypassing the hook only for that case, and only on the owner's explicit yes); the phase gate covers the integration.
- **Team mode:** batch mode (the main session leads) for features under about 5 units; orchestrated mode only above that.
- **Fix sets:** a small fix set gets one checker that does the fix check AND the re-sweep; a large fix set keeps both passes.
- **Reviewers:** every PR, large or small, gets practical reviewers sized to its stakes, and each reviewer is held to its step limit in the brief and the meter; a role over its limit is a contract miss.
- **Crashes:** a machine crash (access violation, segfault, spawn failure) is logged (date, step, what else ran), not investigated; when crashes come often, ask the owner to free the CPU or say when the machine is free.

### Sub-Agent Verification Step

After GREEN on substantive logic, a fresh read-only agent sees spec + tests + implementation and hunts for overfitting. Skip for trivial changes. Why: a solo developer has no human reviewer.

```
You are independently verifying an implementation. You have no prior context.
Inputs: Spec [link] | Tests [link] | Implementation [link]
Verify: (1) ALL spec behaviours handled, or only the tested ones? (2) Edge cases the spec implies but tests
miss? (3) Ways to pass while subtly wrong (off-by-one, wrong default, silent failure)? (4) Security constraints
and _Component Security Checklist.md respected? (5) Each new test guards a real use and can fail?
Output: VERDICT PASS / FAIL / NEEDS-DISCUSSION; issues with file:line. Return findings as your final message.
Do not edit any files.
```

---

## Test Integrity (Tests Never Yield to Implementation)

**NEVER compromise a test to pass the implementation.** Why: a test that always passes gives false confidence and ships green bugs.

**When a test fails:** (1) dump what the implementation actually produces; (2) compare to the spec; (3) implementation wrong -> fix it; (4) test wrong (wrong place, outdated detail) -> fix it to the spec's intent and document why; (5) NEVER weaken, relax, accept "close enough", swallow, or skip.

**Allowed:** moving a test's LOOKUP location - assertion unchanged, output verified correct at the new location FIRST; changing a spec assertion only after a spec change locked with the owner; adding diagnostics; a documented platform skip only when the TEST PLATFORM lacks the API (the comment states why, and where real coverage comes from).

**Forbidden:** weakening an assertion; relaxing a regex; wider ranges than the spec; silent catches around assertions; `.skip()` on a real failure; deleting a "flaky" test without its root cause; moving a lookup without verifying the output there.

**Integrity is the line, not immutability.** Edits that do not lower what a test proves are maintenance: (1) raising the bar (new case, tighter assertion, security coverage); (2) realigning an expected value to a LOCKED rename / structure change (matcher, strength and intent unchanged). In an approved loop these are autonomous when pre-listed in the loop contract - never invisible. **Always a hard halt:** anything that lowers what the test proves. The test: *would this let genuinely broken behaviour pass?* Yes -> forbidden.

**Verification-first:** don't touch the test -> dump the actual output -> does it meet the spec's intent? -> yes: update the lookup, keep every assertion; no: fix the implementation. Skipping the dump compromises the test by assumption. Why: the gap between "test passes" and "code is correct" is where low-effort products live.

---

## Design for Human Error

- **Exact-entry fields** (passphrase, code, key) let the person SEE what they entered and find the wrong part: name the error's position; offer a reveal. Retyping blind is not recovery. Why: people who fail blind give up and never return.
- **Weigh the reveal at design time** beside the security cost; keep the leak guards (masked to keyboards and spell check, copy refused, cleared on hide or lock).
- **A design that rules out a reveal** records why and the human-error cost, for the owner's call.
- **The human factor:** every option list for a hurdle (a lock, code, confirm, required step) answers first: (1) what it protects and its value to a stranger, now and with planned features; (2) the realistic threat, not the worst; (3) what a real person can remember and repeat daily; (4) how someone who forgets recovers. Pick the lightest hurdle covering the realistic threat; say in the copy what it does not cover. Why: a hurdle people cannot live with is bypassed or abandoned.

---

## Test Value (Practical Tests, Not Test Counts)

**Every test names the real use or real failure it guards** - a person on a screen, a caller or agent on an API, an attacker's input, a bug that happened. No answer -> not written. Why: fluff raises counts and upkeep, not confidence.

**Proof by break:** break the code the way a real bug would and show the row that turns red, on an assertion. A row no plausible bug reddens is rewritten or cut; a plausible bug no row catches gets a row.

- **Keep:** behaviour through the seam its user uses (screen, exported function, protocol), not private helpers; every security / privacy / legal rule and reachable failure path; boundaries with one case each side; a named regression test per real bug; table rows only where each row is a different branch or real input.
- **Cut:** tests restating the code; second proofs; assertions on freely changeable internals; rows reaching no new branch; tests passing against a do-nothing stub (unless a break-checked "nothing happens" check).
- **Checked by:** the break check; builders naming the use of any test beyond the brief; checkers filing low-value tests as `test-value` findings and ruling keep / cut / repoint on each added or edited test; one value pass in every Pre-PR sweep; **fix forward** (cut fluff only in files a PR already touches, when cheap and shown safe).

Coverage and counts are signals, never goals.

---

## Loop Workflow Mode (Keyword-Gated Autonomous TDD Loop)

An opt-in overlay for mechanical TDD work, under graduated trust; the default stays manual. Files and visuals only via a pre-agreed **loop contract**; visuals also pass the Visual-correctness gate.

**Loop-First Scoping (mandatory consideration).** At the start of every substantive task, scope loop-worthiness and state the verdict: name the mechanical slices (test shape + implementation + commit message all pre-determined) vs the parts needing a choice or a human eye. Not looping is valid; not considering is a miss. Never manufacture abstractions to hit a count. **The bar never moves to fit the loop:** raise it (clearer plan, real tests) or loop less. Why: the loop offloads grind; it must never buy speed with integrity.

**Self-Correction Boundary - self-correct mechanics, escalate choices.**
- Self-correct (log the lesson; ~2 attempts per failure): an edit anchor miss (re-read the bytes); a typo or wrong import; an API differing from the guess (read the installed types / README); an under-tested implied branch (add the test).
- Escalate even when a fix is reachable: any decision outside the plan; any integrity-LOWERING test change; a file off the manifest; a spec / ADR / public-interface change; non-convergence after ~2 attempts; anything needing the owner's visual / legal eye.
- **Unmovable:** never lower a test's integrity; cap at ~2-3 attempts. Why: "self-correct more" must never become silent drift.

**State machine.** OFF by default and after every compact. Armed only by the owner's exact phrase **"begin loop workflow"**, after a clean orientation, a learnings scan in Claude's report, an agreed contract (when files or visuals are involved), and the owner's comfort. ANY owner message mid-loop halts it. Why: a persistent keyword outlives the context that justified it.

**Loop contract (before the keyword):** files to create (path, why, the reference it mirrors - any other file = hard stop); visual increments with their LOCKED reference; the expected test collisions from a repo-wide search. Every run is bracketed: a plan before, a LOOP SUMMARY after.

**What it automates - only tasks whose test shape, implementation and commit message are all determined:** (1) write the failing test; (2) run it, show it FAIL for the right reason; (3) minimal code; (4) run, show real counts, GREEN + whole suite green; (5) one-line `type: subject` commit; (6) next. Claude runs the test runner and local git in this mode; **push is never automated.** Why: a bad loop unwinds locally. **Command environment:** <!-- PROJECT ADAPTER A11: the tool-shell prefix that finds the right runtime with no installs. -->

**Visual-correctness gate.** Tests verify structure, never appearance. After at most **3 visual increments** (any human-facing output; pure logic does not count) the loop HALTS for a Visual Checkpoint, even when confident; any doubtful visual halts at once; nothing visual reaches the remote unseen. An unreachable state is shown on a throwaway route via a scratch script at narrow and desktop widths in every theme, MEASURING overflow, deleted before the next commit; stop the preview server before any rebuild.

```
VISUAL CHECKPOINT - <arc> (<date>) - <N> visual increments since last check
Built:         <increment -> commit>
Expect to see: <what renders, in which states>
How it works:  <the interaction>
Questionable:  <contrast / spacing / color / copy, or "none" only if truly none>
Verify at:     <routes> -> loop HALTED, awaiting your OK
```

**Hard stops:** any unexpected test result; any unlocked decision / naming / format / style; any off-contract file or unverified visual; public-interface or spec / ADR changes; a 4th visual increment; the end of the mechanical tasks or the goal.

**LOOP SUMMARY** (BLUF first, real numbers, ~12 lines max - longer means the loop ran too far without a gate):
```
LOOP SUMMARY - <arc> (<date>)
Status:  on track | blocked | goal reached
Done:    <task> -> <hash> <type: subject>     (one line per commit)
Tests:   <RED->GREEN each; N/N suite green; pre-commit passed>
Locked w/ you: <gated decisions, or "none - all pre-locked">
Decided alone: <decision -> choice -> impact test + evidence -> why, or "none">
Stopped: <gate / end / goal> -> <question or next step>
Flags/learnings: <for _Loop Learnings.md, or "none">
Next:    <exact next action awaiting your go>
```

**Learnings + graduated trust.** Capture only behaviour-changing lessons (an owner correction, a plan under-spec, an anomaly + root cause, a near-miss, a visual that looked wrong while green) via the `Flags/learnings` line. Review at every re-arm ("N open, 0 recurred") and phase end. A recurring or systemic lesson graduates into this file and is archived. **Repeat = REGRESSION:** hard stop, `REGRESSION: L-NN recurred`, scoreboard bump. Why: corrections falling and regressions at zero is the accuracy signal.

### Graduated loop lessons (standing; a repeat is still a regression)

1. **Find everything a change invalidates, repo-wide, before the first edit** - source, tests (E2E too) and tracked public docs: the value, the bare name, regex selector forms; let the type-check find typed users; read every test of the changed component; a change to how a value is SHOWN searches for the value AS SHOWN. The collision list comes from the scan, never memory.
2. **A test must be able to fail** - fixtures sized past the threshold; disarm a second guard that could produce the same value; re-derive fixtures when a threshold changes; after green, remove the behaviour and see red on an assertion, not a crash. A "nothing shown" check right after an action proves nothing; re-prove layout cases across the real width range.
3. **Never push escapes through a shell or tool parameter** - build non-ASCII at run time; edit with the Edit tool on fresh bytes, never `sed` or heredocs; prove a check fires (true on a bad character, false on ASCII) before trusting its silence.
4. **Anchor every edit on freshly read bytes** - formatters change bytes; line-scoped directives go where a formatter cannot split them.
5. **Thrown errors carry static opaque codes** - new error paths and helpers are where it slips; check CI-only gates too.
6. **The tool shell's runtime** - see "Command environment".
7. **Never `cd` into a subfolder** - the shell keeps its directory; use quoted absolute paths or `git -C`; the only `cd` is to the root.
8. **Stop the preview before any rebuild; show unreachable states on a throwaway route.**

**Manual-mode reminder:** while OFF, after each manual commit add one line that "begin loop workflow" is available, naming the next chunk when it is loop-worthy.

---

## Spec-Driven Development (SDD) Triangle

**Spec + tests + code stay in sync;** a change at one vertex examines the other two. Code changed -> spec updated? tests cover it? (else justify in the PR, ADR if structural). Tests changed -> did the spec require it? Spec changed -> plan the drift fix in `_Active Plan.md`. Pre-merge: source changed without spec, ADR or tests? Ask why. Why: silent spec drift makes a later session re-implement the old behaviour.

**Locked-Decision Drift Markers.** When code deviates from a locked ADR / spec decision, in the SAME session either fully amend every affected location (with a Revision History line), or add an inline `> SUPERSEDED (<date>): <what changed> - see <pointer>` at EACH location AND log the pending sync in the plan's "Execution Notes & Deviations". **A canonical doc is never silently stale:** the rewrite may batch, the WARNING may not. Markers link forward and never delete the old prose. Why: a reader landing on a stale line will not know to read the plan addendum.

---

## Security Standards

Top priority. The baseline, data boundary and platform controls are A3/A4.

- **Baseline:** a named verification standard (e.g. OWASP ASVS Level 2); the data boundary is architectural and tested, not policy; no trackers or analytics unless A5 allows.
- **Secrets:** none in client code, ever; none in history (env files gitignored, values never printed); keys never ship to the client (a backend proxies); client-held tokens encrypted at rest. **A dev server may hold live secrets:** scripted walkthroughs block every outside-service route, proven by a control. Why: a test run can send real email or spend real money.
- **Per-component checklist:** `_Templates/_Component Security Checklist.md` completed BEFORE a component is complete. Why: security reviewed last is security bolted on.
- **Dependencies:** a scheduled updater; advisories raised as PRs; no unaudited dependency in a critical path; an unfixable high -> research removing the dependency first, a scoped documented ignore only if it cannot reach production.
- **SAST** on every PR; high blocks merge; triage within a week; run CI-only scanners locally on changed files before reporting done.
- **Cadence:** a staged-diff scan before every commit + the Pre-PR Deep Sweep before every merge.
- **Threat model** in the spec, re-reviewed each major version; novel surfaces get a mini threat model in their component spec.
- **Disclosure:** a published `security.txt` (or equivalent) with a contact and SLA (e.g. acknowledge 48 h, triage 7 days).

---

## Pre-Commit Discipline

Every commit passes lint, format check, type-check, related tests and build via a hook. **Never `--no-verify`.** Run each commit alone; after a failure read `git status` and the hook log; never chain a commit after a failed one. Why: chained commands run on whatever the failure left staged. <!-- PROJECT ADAPTER A9/A15 -->

### Commit Message Format

One line: `git commit -m "fix: hold the page still behind the open reader"`.
- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`, `perf`; a scope is optional and rare.
- **Subject:** imperative, lowercase, no period, what the change does for a `git log` reader; no task / phase tags or asides.
- **No body, no footer, no AI / tool trailer** - even when a harness asks; the owner's rule outranks it. Detail goes in the PR body, the Session Log and comments.
- **Tell:** reaching for `-F`, a heredoc or a second `-m` means the message is already wrong.
- **Check first:** `git log --format=%s -20`; if this section and the log disagree, the log wins and this section is fixed. Why: a documented convention nobody practises misleads every new agent.
- **Enforced** by a `commit-msg` hook + a CI check over the branch's commits. <!-- PROJECT ADAPTER A15 -->

---

## Branching

`main` always shippable; short-lived `<type>/<name>` branches (1-3 days); squash-merge; linear history; PRs for anything non-trivial (review pause + CI).

**Branch names:** `<type>/<plain-kebab-description>` (`feature`, `fix`, `chore`, `test`, `perf`, `security`) saying what changes in plain words; no internal codes, no tool prefixes (`claude/`, `worktree-`); read recent PR branch names first. Why: a branch name is public, like a commit subject.

**Branch-first:** before the FIRST edit to a tracked file for a feature, be on its branch, not `main` (`git checkout -b`; uncommitted work carries over); gitignored vault edits exempt. **Highest-risk moment: right after a merge**, when the next sub-project's edits accrete on `main` - branching is the first action of any new issue. The tell: proposing a PR while on `main`. Why: branching tied to a later step is skipped by work that comes first.

---

## PR Body Standard

Formats in `_Templates/_PR Body Template.md`, chosen by the SAME stakes split as the sweep: **Standard** for features / sub-projects / design decisions / new behaviour (deep sweep); **Lean** for chores, docs, config, bumps, one-line non-behavioural changes (light check or exempt).

- **Hard rules (outward-facing):** ASCII; no AI / agent / tool references (reviews described BY DIMENSION + verdict); no links to gitignored vault docs; value-led title `<Area>: <line>`.
- **Lean:** 1-2 sentence framing, <= 3 changes (what and why, no file lists), 3 gates (the proof; the full gate as one line; the sweep exemption by dimension), <= 1 sentence of notes; audited word / line ceilings.
- **Standard:** before / after table for changes; decisions and review result on screen; file list, gate figures and clean checks in folds; never cut a detail - fold it; audited total, on-screen and per-bullet ceilings; plain engineer speak.
- **Never inflate a small PR.** Audit runs and is shown with every body; the rendered body + audit go to the owner BEFORE any push or PR command. <!-- PROJECT ADAPTER A16 -->

**Every outward piece starts from its format:** a PR body, release notes, a public doc, a README or a post begins by reading its template, its rule and the two latest lived pieces of the same kind, and runs its audit; the hand-off names the sources. Public prose the owner publishes as themselves avoids AI tells. Why: writing from memory drifts the format a little every time.

---

## Release Notes

**After every merge that changes what users get, a release follows** (push -> merge -> branch delete -> Post-Merge Check -> release).
- **Match the latest release's format** - read it first. <!-- PROJECT ADAPTER A17 -->
- **Lead with this release's value**, not the last post's pattern; check every date.
- **Semver:** patch = fixes / quality; minor = new user-facing features; major = breaking. State the reasoning and square it with the version plan.
- **Public prose:** plain words, the project's public style, no AI references, no vault links, only claims the merged code supports - audited.
- **For non-technical readers:** what a user gets, short; honest limits beside the claims they limit; tests, tooling and bumps stay out.
- **The owner publishes or approves each publish;** Claude drafts notes and version and publishes only on an explicit go.
- **The work PR carries the version bump** - never a bump-only PR; with several PRs the last to merge carries it; hold the bump while the merge date is unknown; tag the tested commit.

Why: a release is a public claim, drafted from format and code and published only by the owner.

---

## Post-Merge Check

After every merge, before the release and before calling it done, verify the live system, each step shown with its result: (1) **the deploy landed** - the live build identifier postdates the merge (wait and re-read); (2) **the critical path answers** - one real request returns the expected status and version fields; (3) **a mismatch is an outage**, not a check - tell the owner at once and run the runbook. Retire it when CI does it. Why: hand-deployed parts drift from merge-deployed parts silently. <!-- PROJECT ADAPTER A18 -->

---

## Multi-Agent Discipline

Parallel READ-ONLY agents that report back work well; parallel CODE-WRITING agents on shared state produce inconsistencies. The difference is shared mutable state.

**Scope before you fan out.** A mode signal ("begin loop workflow", "ultra" modes, "token cost is not a constraint") authorizes the KIND of work, never its SIZE. Before any multi-agent dispatch, state the count and what each layer buys, then stop for the owner's go. **Scale verification to stakes:** refute panels only for critical / high; below that, read and adjudicate. "Exhaustive" means coverage (angles, files, risk classes), not re-litigating one finding. A mis-shaped run is stopped, the wasteful stage reshaped, and resumed from cache where possible. Why: orchestration gets the same gate code gets.

### The Swarm Contract (NO swarm without one)

Before any swarm (Pre-PR Deep Sweep, Mid-Design Red-Team, any fanout) emit and STOP for the owner:

| # | Role | The distinct question ONLY this role asks | Context injected | What a finding looks like | Token budget |
|---|---|---|---|---|---|

1. **Count is DERIVED, never chosen** - enumerate the distinct risk regions; the count falls out.
2. **Every agent asks a question no other asks** - "what could this role find that the others structurally cannot?" No answer = a clone; delete it.
3. **Redundancy is not coverage** - an agent bound to another's finding ("refute this") can only subtract; duplicate verification only for critical / high, max 3.
4. **One slot always goes to the NOVEL lens** - a completeness critic: "what did every other role miss?"
5. **Context is per-role** - each role gets the files, rule and spec clause its lens needs; boilerplate makes generic agents.
6. **The diff is not the blast radius** - code a change was MODELLED ON ("mirrors X", copied, generalized from; found in its docstrings and design notes) gets its own role: inherited or introduced?

**Rigor = distinct questions asked, not agents asking** (measured: ~130 refuters on the same targets added nothing; one completeness critic found the three biggest misses). **A refute panel informs; a reader adjudicates** - panels score wording, not truth; a finding refuted by a panel but confirmed by reading the code is REAL (for privacy-first work a false negative costs more). **Post-run yield check:** record findings per role; a role silent across two sweeps is cut; a gap the critic keeps finding becomes a role. In an orchestrated team the contract still reaches the owner via the overseer; every sweep and re-sweep is the owner's to approve.

### Patterns and Dispatch

| Pattern | Status |
|---|---|
| Parallel read-only agents (research, exploration, verification) | OK, encouraged |
| Sequential agents passing narrow context | OK |
| Parallel code-writing agents on shared files / state | NEVER |
| Parallel builders, each in its own worktree on a file list no running unit shares, merged by the lead | OK (Agent-Team Build); shared file / port / fixture -> run in order |
| Agents editing spec / ADRs / tracking files concurrently | NEVER |

- **Modes:** parallel (one message, several Agent calls, parent aggregates); sequential (narrow context passed on); background (parent continues, is notified).
- **Model tiers:** top tier (e.g. Opus) for high-stakes reasoning, design, security, checking; mid tier (e.g. Sonnet) default for coding and analysis; small tier (e.g. Haiku) for high-volume narrow scans, re-checked by the requester. Pin exact versions in role files; a change is the owner's call.
- **Constraints:** agents inherit permissions (a research brief names the web tools allowed; a shared browser pane is not one); they see no chat history (self-contained briefs); their claims are direct-read verified before any lock; report agents return findings in their final message, not files.
- **Main conversation** keeps decisions, locking and design with the owner; agents do legwork. The owner's time = decisions.

**Dispatch decision - default is direct execution** (except inside an approved Agent-Team batch, where builders are the default for build units). Dispatch when ANY apply: real complexity (3+ files, architecture, subtle correctness); security stakes; independent review adds signal; parallel-safe work; context isolation. Prefer direct when ALL apply: mechanical; failure = "doesn't compile / test fails"; precise plan; under ~30 minutes; no security stakes. Hybrid: direct build + one read-only spec reviewer when anything non-trivial was touched. Record tokens, time, whether the reviewer caught something real, and net worth; recalibrate after 3-5 dispatches. Why: agent overhead earns its keep only on proportional value.

### Agent-Team Build: Project Adapter (FILL-IN TEMPLATE)

The portable playbook is user level and identical everywhere: the `agent-team-build` skill (roles, flow, who decides, the bar, cost, scoreboard, templates, batch and orchestrated modes) and role files (`builder` - mid tier, own worktree, cannot start agents; `checker` - top tier, read-only; `orchestrator` and `scanner` for orchestrated mode). Role files skip CLAUDE.md, so field 8 rides in every brief. **The owner's approval of a batch plan starts the build;** push, PR, merge and release stay the owner's.

<!-- PROJECT ADAPTER: fill every field before the first batch. -->
1. **Adopted:** <date>. **Scoreboard:** `_Loop Learnings.md` "Agent-team scoreboard".
2. **Full gate:** `<command>`, copied from a full read of every CI workflow and re-diffed when one changes; `<worktree flag>`, `<port flag>`. Green = every step exit 0 in `<summary log>`. Only the lead runs it, after integration, preview servers stopped.
3. **Fresh worktree:** `<shell prefix>` then `<frozen-lockfile install>`; confirm on the first run that the unit suite passes there; needed gitignored files go in `.worktreeinclude` (never secrets).
4. **Parallel limits:** `<shared ports, browsers, databases, fixtures>` and how the lead assigns them.
5. **Extra hard stops:** Tier 0 (`<A2>`); visual / copy changes without a locked wireframe or copy line (Visual Checkpoint after <= 3 visual units); any budget raise; spec / ADR changes; the Pre-PR Deep Sweep under a Swarm Contract before any PR.
6. **Records:** the plan's `## Progress`, ticked with evidence (the plan file is the progress record); `Decided alone` in every rundown; tracking files at session end; lessons and the scoreboard line in `_Loop Learnings.md`.
7. **Conventions:** branch first; commit format; Test Integrity; comment philosophy; graduated lessons. Inside a batch the lead and builders run the test runner and local git; builders share a commit lock; Edit Discipline's steps live in the batch plan and builder reports.
8. **Rules every brief carries** (verbatim in every builder and checker brief):
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

Durable tools live in a gitignored tools folder, never a session scratchpad.

---

## Mid-Design Red-Team (Security Verification Before Lock)

**Before locking any design touching personal data, encryption, authentication or external surface, red-team it inline.** Why: a design-time flaw is a paragraph of spec; a post-build flaw is a redesign, rebuild and migration.

- **One iteration:** 3 read-only red agents in parallel - **Red-A** privacy / data exposure (logs, dev tools, side channels, URLs, caches, background workers, errors); **Red-B** crypto / keys (extraction, misuse, KDF weakness, downgrade, lifecycle); **Red-C** app logic (races, state corruption, replay, crafted-input DoS, schema bypass, error states) -> findings numbered with severity -> 2 white agents (**White-D** privacy + crypto patches; **White-E** logic + cross-cutting) -> the controller integrates.
- **A safety-critical LLM prompt** gets its own red-team (misattribution, gate evasion, scope, delimiter forgery, refusal) plus a novel-lens slot.
- **Three iterations,** fresh agents each. **Converged** when the last finds no new whole-mechanism gaps (zero findings is not the bar; inherent constraints are DOCUMENT-ONLY). A new mechanism gap in round 3 -> one fresh confirmation round; another -> back to Plan.
- **Scope review after round 3:** each finding-patch pair is LOCK (in model, fixable, cost <= value) / DEFER / DOCUMENT-ONLY / GOVERNANCE. Why: honest residuals beat pretending.
- **Top tier for all agents.** **Scope:** the design, the locked foundation under it, its integration points (structural foundation findings -> ADR supersession).
- **Apply** to data, crypto, new external surface, or on request; **not** to pure presentation, untouched internals, or property-preserving refactors.
- **Capture** each finding inline where its patch lives AND in the spec's Security Considerations section (finding, severity, fix, status).

---

## Correction & Learning Loop

On an owner correction: **acknowledge** (don't defend); **capture** a specific actionable rule here or in memory; **sharpen** it if the mistake repeats; **re-read** the relevant section before working in that area. Make style corrections durable the moment they land. Why: a correction living only in chat is re-made next session.

---

## Autonomous Fixes

**Fix and report:** contradictions between docs, stale references, broken links, missing imports, obvious bugs, typos. **Small and easy now:** a small, easy finding or follow-up is fixed in the current PR; only large, risky, device-only or design items go to the roadmap, all recorded. **Ask instead:** ambiguous design conflicts, changed requirements touching locked decisions, unclear intent. Why: asking about the obvious wastes the owner's time; deciding the ambiguous takes their decision.

---

## Failure Response Discipline (Triage Before Fixing)

Run BEFORE touching code when a test fails, a build breaks, or behaviour surprises. Why: guessing at a mis-triaged failure burns hours and adds worse problems.

1. **Triage:** production bug or test-environment artifact? In scope now or a deferred task? Then fix now / defer / document as residual.
2. **Diagnose with data:** the FIRST action is a diagnostic dumping real state (computed values, requests, served bytes, env) - not a fix; hypothesize from the data; after 2 failed attempts stop guessing and dump; for an unobservable bug get data before fixing; a surprising number is first a claim about the instrument - run a known-good / known-bad control.
3. **Verify before push:** run affected suites locally before committing (E2E is often outside the hook; CI is the last resort); CI / config changes land in the SAME commit as what needs them.

---

## Enumerate Before You Count

**A count from a pattern you invented measures the PATTERN.** Before a detector for a class ("junk", "violations") yields a number: (1) print every match in context and read them all (too many to read = too broad for a rule); (2) report the false-positive RATE, not the total; (3) count distinct matched tokens and neighbours (two findings can wear one number); (4) anchor the rule on what enumeration showed, not the assumed shape. A capped search is not an absence; a grep finding your own new text is not verification. Why: a speculative count justifies expensive, content-destroying remediation.

---

## Probe Scope

**A passed probe proves only what it ran.** List the probe beside the real use row by row (model, tools, depth, place, length, load, data) and mark each **MATCHED** (run as the real use will), **GATED** (a new probe passes before anything builds on it) or **CANARY** (the first small real run shows it; name what to watch). No plan built on a probe is approved with a row unmarked; assumptions only a real test can settle become gates that pass first. Why: necessary is not sufficient.

---

## Snag Response: Least-Invasive Path, No Padding

After triage and diagnosis: (1) recommend the most logical LEAST-INVASIVE path (existing / no change -> local or config change -> the owner's global environment, last resort, explicit OK, never silent); (2) recommend, don't lock - one good option is presented as one; no padding; (3) verify the path works before asserting it; (4) document snag + fix where it belongs (Session Log, plan notes, `_Loop Learnings.md`, ADR). Why: padding buries the recommendation, and an undocumented snag recurs.

---

## Justify Every Direction Change

When an agreed direction changes, state: (1) **why it changed** - the new information; (2) **how it is better** - the concrete difference; (3) **why it is better** - risk avoided, cost saved, quality gained; (4) **a direct reference** - file / line, standard, ADR, shipped precedent or measurement. Then the owner locks it. Missing any = a **silent pivot**, forbidden. Why: the owner audits the turn without re-deriving it.

---

## The Finding Pipeline (Sweep Finding -> Fix)

**A finding is a HYPOTHESIS, not a work order** - is it true, reachable, why does it break, is the fix confirmed, what does it touch. Why: collapsing these into "read finding -> write fix" makes each fix break the next thing. NOTHING is fixed until every finding clears G3.

- **G1 Triage** (per finding): TRUE? (read the code, quote the line; the finding's own quote is not evidence) REACHABLE on an ordinary path? WHICH rule does it break (none = not a finding)? Not-real dies here.
- **G1a Evidence bar - reproduce it OR quote it.** "Only if you can make it fail" confuses UNREAL with UNOBSERVABLE (memory hygiene, for one, has no symptom). Truth = (1) a red test someone watched fail (mandatory when the class is observable), or (2) a direct read with ALL THREE of the quoted line, the hard rule, and **an in-repo precedent enforcing that rule on the same class** (no precedent -> backlog, not blocker). Reachability sets severity, not truth. Sweeps produce candidates only; **the controller adjudicates**; a sweep's "blocks merge" flag is an input.
- **G2 Diagnose** (per survivor): the mechanism in one sentence; the violated invariant; `git blame` (ours, or shipped and exposed?). Output: **a named root + a search pattern.**
- **G3 Cluster + search** (BARRIER across all findings): group by root; search the WHOLE codebase for each class, shipped code included; fix shared findings at the root (often one token or helper). **Roots get fixed, not findings.**
- **G4 Method** (per root): the CONFIRMED fix with precedent; what it does NOT fix; **which side-effects of the current code it MUST preserve** (the highest-value question). A fix is new code - scrutinize it, most of all when it changes shape (sync -> async).
- **G5 Blast radius** (per root -> the owner's go): files, shipped vs new, public interfaces, other callers, the revert story. A fix to shipped code in a feature branch is scope creep until the owner says otherwise.
- **G6 Fix** - TDD, **one ROOT per commit.**

**Two hard rules:** (1) batch at G3 - triage and diagnose everything, then fix roots; (2) re-sweep ONCE over the whole batch, never per fix (sweep -> fix -> sweep is an undamped loop). **Cadence: two passes** - one large sweep, one SHORT re-sweep of whether the fixes broke anything; a third only for a major re-sweep finding.

### Features First; Findings Ride Inside the PR

1. **A standalone fix PR only for harm:** data loss, a stuck user, a silent outage.
2. **Sweep findings are fixed in their PR by default**, not only the easy ones; defer only the extremely minor (info, cosmetic, rare path, no harm), each recorded.
3. **Two passes only;** leftovers go to the next focused PR touching that code or a later fix sweep - the owner decides.
4. **Then features;** roadmap fixes ride a feature PR that touches their code.
5. **The body follows the PR's size;** folded-in findings go in the before / after table.
6. **A run's order:** the owner picks the feature FIRST (even when a handoff lists fixes ahead); leftovers and the last PR's recorded carry-overs are built on its branch (unless large, risky, device-only or a design call); ONE large sweep after both are in, then the short re-sweep; one PR. The Resume Point names the feature pick first.

**Value check:** tier remaining work by what a user would notice, and recommend stopping when reviews return ever smaller things. Why: diminishing returns are a signal, not a challenge.

---

## Re-Plan on Failure

When work shows a locked decision is wrong: **STOP**; flag "this conflicts with [decision / ADR]; revisit before continuing"; assess what depends on it; present options (unlock and re-lock if needed); then resume. Recommend the root fix scaled to stakes, not the lazy shortcut. Why: items built on a flawed foundation cascade.

---

## Simplicity Lens

Before locking: *"Is there a simpler version with the same outcome?"* Complexity is earned; 3 lines beat 30; no over-engineering for under-1% edge cases or problems users won't meet - but never simplify away depth that creates real capability. Why: every piece of complexity is paid for in every later change.

---

## Dual-Horizon Recommendations

Every recommendation is judged on **current-version fit** (scope, locked architecture, Simplicity Lens) and **end-state fit** (the finished product per roadmap and spec). For each contender: what it commits us to; which horizon it wins; the **rework cost** if the horizons differ (one-site swap vs schema migration vs re-architecture); the **accepted-debt verdict** (deliberate and documented, or a compounding trap). Horizons agree -> one line.

**Always answer:** (1) impact now; (2) impact later (future content, features, versions, maintenance). If a future version will FORCE a change, the pick is TEMPORARY; "durable" is defended by its mechanism.

**Temporary-fix gate:** name the robust built-once option; quantify the delta (extra work now vs the later forced change + risk, including compounding); choose robust when the extra work is modest and the later change real or compounding; choose temporary only when robustness is disproportionate AND the later change cheap, isolated and non-compounding - recorded as accepted debt with its retirement trigger. Why: the cheap-now pick, taken by reflex, is paid repeatedly. Paired with the Simplicity Lens: earn complexity, and know what each deferral costs.

---

## Success Charter (Define Success Before Building)

Written BEFORE building differentiator or high-uncertainty work: (1) **Expectations** - "working" in plain user terms; (2) **Success Criteria** - measurable where honest (recall@k, latency, bytes), explicit-qualitative where a number would be invented - the acceptance gate; (3) **Options** tied to how each moves the criteria; (4) **Scaling Plan** - trigger, thin -> full path, cost; (5) **Ambition Tiers** - functional end goal, and a separated GATED stretch with what it needs. **Corrections:** scale rigor to stakes (one line or skip for mechanical work); no fake numbers; never build toward the stretch before the functional goal is met and validated. The tiers ARE the Dual-Horizon horizons. Why: work without a defined bar is never done, or never good enough.

---

## Milestone Project Sweep (Periodic Multi-Agent Audit)

A MECHANICAL GATE with a checkable done-condition. Why: a sweep without a clear trigger never happens; assumed done is not done. **Prerequisite: an approved Swarm Contract** (same for the red-team).

**Triggers:** (1) **before any substantive PR to `main`** (new behaviour or surface, security / privacy / legal relevance, a sub-project; when unsure, swarm) - the Pre-PR Deep Sweep; trivial chore / docs / one-line PRs run a light pass or are exempt, stated; (2) **mid-build** when an arc adds a new runtime dependency or external data flow. A **comprehensive launch-gate sweep** of EVERY surface precedes any public major version.

**Done iff** a report exists at `<sweep folder>/YYYY-MM-DD-<milestone>.md` with date, milestone, branch / commit; each dimension PASS or with findings; every high / critical dispositioned (`FIXED <commit>` / `DEFERRED <where>` / `ACCEPTED <why>`); and for the deep tier an explicit "still aligned with the version goals? YES/NO + evidence". <!-- PROJECT ADAPTER A22 -->

**Six fixed dimensions, every time:** (1) privacy / data boundary - leaks or third-party calls at runtime; (2) supply chain + bundle - dependency risk, build scripts, budgets; (3) legal / content + licenses (A2), citation fidelity; (4) code security + pattern consistency (an adversarial swarm in the deep tier); (5) gaps + scaling - untested paths, deferred-now-load-bearing items, scale assumptions, plus a value pass on new tests; (6) version goal / vision alignment - scope creep, drift from locks, overbuilding; yields the verdict. Plus any milestone-specific dimension. Mechanism: read-only reviewers per dimension -> adversarial check of high / critical -> a report grouped by when to act.

### Pre-PR Deep Sweep

- **Adversarial vulnerability swarm:** >= 3 top-tier security agents with DISTINCT angles (e.g. injection / output / security policy; secrets / exfiltration / auth; logic / race / DoS / supply chain).
- **A Test Value agent** ruling on every added or edited test (keep / cut / repoint, the use guarded, a break check where in doubt); retired when reviews stop finding fluff.
- **Every high / critical independently re-checked** - an input to the controller's adjudication.
- **Dimension 6 mandatory.** **Covers the branch HEAD** - an older report does not count; re-run or sweep the delta.
- **Anti-hallucination clause:** satisfied ONLY by the agents actually running THIS session AND the report existing with their findings, dispositions and verdict - never by the controller's read, a recalled sweep, or "it looks fine". No report -> no PR.

### Pre-Push Op-Test

Reviews read code and tests check imagined paths; neither USES the product. Before a major or user-facing PR is pushed:
- **On the production build** at the PR head, served locally.
- **The lead's walkthrough:** every spec flow at desktop and narrowest width, every theme and engine, console watched, screenshots to the owner (a scripted walkthrough where the pane cannot load it).
- **Break-it testers** (mid tier, default three, one distinct angle each - e.g. input order / rapid taps / date edges; tabs / locks / reloads / offline; keyboard / screen reader / zoom / forced colors), each with throwaway scripts in its own scratch folder, read-only on the repo, every finding with a reproducing script, one shared brief.
- **A live checklist** the owner can watch, ticked as items pass; the owner may hand the rest of a walk to the lead.
- **Findings go through the Finding Pipeline before the push;** "push now, fix later" is the owner's call.
- **Scale:** docs / chore / test-only / one-line PRs exempt (stated); small PRs may run the walkthrough only, on the owner's call.

Satisfied ONLY by the walk and testers running this session with results in the sweep report. Why: a green gate and two sweeps still miss what a minute of real use finds.

### Preview Test Before Merge

A user-facing PR is used on the host's own build of the branch, on a real target device, before merge. Open the link yourself first; made-up details only; outside-service routes blocked in scripted runs; nothing sent (previews may hold live secrets). A desktop throttle does not stand in for a real device. Why: the production platform and a real device are what local tests cannot imitate. <!-- PROJECT ADAPTER A19/A20 -->

### Visible Tracking

`_Master Roadmap.md` carries `- [ ] Milestone sweep recorded -> <report>` per sub-project, and **no sub-project is marked COMPLETE until it is checked**; no PR opens or merges without a current report; orientation checks both. The red-team (design time), the sweep (post-build) and per-task verification (unit level) complement each other.

---

## Parking Lot + Pre-PR Idea Triage

- **Capture** (zero friction): one line under `## Parking Lot` at the top of the active plan - `- <idea> - <where noticed> - hunch: now | next`. No decision, no action.
- **Triage** after all gates pass, BEFORE the deep sweep: **Now** (small, in spirit, cuts churn; growing scope needs the owner's lock) -> built and swept in this PR; **Next** -> one line + pointer in the Roadmap; **Drop** -> deleted with a one-line why.
- **Done** when the lot is **empty** before the sweep; non-empty = the gate was skipped.

**Pipeline:** `build -> all gates green -> Parking Lot triage -> Pre-PR Deep Sweep -> fixes + re-sweep -> gate -> Pre-Push Op-Test -> fixes + gate -> PR body + audit to the owner -> push + PR (owner) -> preview test -> merge (owner) -> Post-Merge Check -> release (owner's go)`. Why: a "now" idea is built and swept inside the same coherent PR; an IDEA is distinct from a FINDING (a defect).

---

## Recovery Protocol

Read `_Start Here.md` -> this file -> `_Loop Learnings.md` -> `_Working Memory.md` -> `_Active Plan.md` -> last log entry -> the Resume Point's spec / ADR / plan; resume from the first OPEN issue. Re-read Collaborative Design Locks; never reconstruct decisions from memory; a pasted handoff line sets the scope exactly.

---

## Project Adapter (FILL-IN TEMPLATE)

Leave `<...>` visible until filled, so a gap is obvious.

| # | Field | Read by | Value |
|---|---|---|---|
| A1 | Project name + one line | Start Here, handoff | `<PROJECT NAME>` - `<line>` |
| A2 | **Domain hard boundaries** (legal, licensing, product lines; content sourcing rules) | Tier 0, delegated decisions, sweep dim 3, brief block | `<fill in>` |
| A3 | **Security baseline** + platform controls (e.g. CSP, integrity pinning, third-party code policy) | Security | `<fill in>` |
| A4 | **Data boundary** (where personal data may live / never go) | Tier 0, red-team, sweep dim 1 | `<fill in>` |
| A5 | Product red lines (e.g. no ads, no trackers, no telemetry) | Tier 0 | `<fill in>` |
| A6 | **Stack** (languages, frameworks, runtimes, package manager + version) | Code Standards | `<fill in>` |
| A7 | File naming, linter / formatter, import grouping | Code Standards | `<fill in>` |
| A8 | Test layout and runners | TDD | `<fill in>` |
| A9 | **Commands:** lint / format / type-check / unit / E2E / build / audit / full gate | Pre-Commit, CI Gate, team field 2 | `<fill in>` |
| A10 | CI workflow files; CI-only scanners | CI Gate | `<fill in>` |
| A11 | Tool-shell command prefix | Loop, team field 3 | `<fill in>` |
| A12 | **Size budgets** + check commands + CI drift margin | Size Budgets | `<fill in>` |
| A13 | Safe logger + error-code lint rules | Code Standards | `<fill in>` |
| A14 | Git split + push guard + its check | Edit Discipline | `<fill in>` |
| A15 | Commit hook + commit-message check | Commit format | `<fill in>` |
| A16 | PR body ceilings + audit commands | PR Body Standard | `<fill in>` |
| A17 | Release format + release audit | Release Notes | `<fill in>` |
| A18 | **Deploy model** (on merge vs by hand; where secrets live) + post-merge checks + runbook | Post-Merge Check | `<fill in>` |
| A19 | Preview builds (how reached / switched on, who does what) | Preview Test | `<fill in>` |
| A20 | **Test devices** (owned; what is NOT verifiable and must be labelled so) | Op-Test, Preview, visuals | `<fill in>` |
| A21 | Visual check set (widths, themes, forced colors, engines) + mockup location | Visual, Op-Test | `<fill in>` |
| A22 | Docs locations (spec, ADRs + index, plans, components, sweeps, engineering docs, archive) | many | `<fill in>` |
| A23 | Owner's shell + quirks (chaining, quoting, multi-line text to native tools) | handoffs | `<fill in>` |
| A24 | Delivery contexts (optional; each feature declares its target context at design lock and is built to that context only) | design locks | `<fill in or n/a>` |
| A25 | Live services a dev server can reach (block in scripted walks) | Security, Op-Test | `<fill in>` |

---

## What This File Is Not

Not the design spec (A22), not the roadmap (`_Master Roadmap.md`), not the history (`_Session Log.md`). It is HOW we work. When in doubt about which file to read: this one first.
