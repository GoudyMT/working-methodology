# Working Standards - <PROJECT NAME>

> How we work. Read this FIRST every session. Every rule here is project-independent; per-project values live in the **Project Adapter** at the end (A1-A25) or a marked `<!-- PROJECT ADAPTER: ... -->` slot, filled when the kit is installed.

**Last Updated:** <YYYY-MM-DD> (<what changed>)

**Terms:** "the owner" = the human who owns the project and locks decisions. "Claude" / "the lead" = the AI session doing the work. "The vault" = the governance `.md` files (tracking files, specs, plans, ADRs), often gitignored. "Tracked" = committed to git.

## Critical Rules Priority Index {#critical-rules-priority-index}

On conflict, the higher tier wins (after Instruction Priority).

**Tier 0 - Identity (violation = project failure / legal exposure)**
1. Privacy & security above all -> "Security Standards", A3/A4
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
3. This file
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

## Visual Design Collaboration {#visual-design-collaboration}

**Visual decisions (how the product LOOKS) are collaborative, never unilateral:** (1) surface what is about to be locked; (2) gather 2-3 shipped references that solve it differently; (3) discuss goal and trade-off; (4) the owner locks (spec visual section or ADR); (5) implement. Why: visual identity is differentiation and cannot be assembled from defaults.

- **Wireframe FIRST.** Every undecided visual (layout, component, state set, number or date format) is decided from a rendered wireframe, never prose. Why: text hides what a picture shows.
- **Inside the real screens, with real data:** each option in the real app with the tap-through flow, not floating cards; numbers and dates from the code; real-length text at the narrowest width ("real text is longer" is a measurement owed: right edges, sideways scroll); the shipped component's responsive and format code read first; mockup copy diffed against shipped strings (an unintended change is a decision or a revert); side-note claims measured or cut. Why: placement and overflow show only in context. <!-- PROJECT ADAPTER A21: mockup location, widths, themes. -->
- **Locatable proof or not decided:** a mockup, spec section or explicit lock; otherwise stop, surface, mock. Never mock an already-locked design. Plan placeholders are NOT locked until the owner confirms ("plan defaults are fine" locks them, one Session Log line).
- **Pre-PR visual verification:** confirm it works, then give the owner step-by-step checks (states, every theme, narrow width, click + keyboard) and what changed vs intentionally unchanged. Why: tests prove structure; only a look proves appearance.
- **Show live** in a browser pane on a dev server; an owner on a phone gets PNG shots of the real app (narrow and desktop, light and dark, forced colors when state marks change), anything drawn in marked. <!-- PROJECT ADAPTER A21: how visuals reach the owner when away from the machine. -->
- **Interaction-pattern consistency:** match the app's pattern for the same CLASS of action (inline-expand for in-context tweaks, modal for heavy / destructive / content moments); a new class gets one pattern proposed for app-wide reuse. Why: two feels for one job reads as awkward.
- **Contrast is an a11y primitive,** not a vote: gate the pair the browser renders (text on the composited background at real size), not a token on the bare surface; fix a shared token once. **No repeated boilerplate in user copy** - a sentence already elsewhere dilutes a new one.
- **Visual code takes Path 1** (explicit approval); Path 2 covers tokens, visual-behaviour tests, non-visual config, appearance-preserving refactors.

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

**Start:** read `_Start Here.md` -> `_Working Standards.md` -> `_Loop Learnings.md` -> `_Working Memory.md` -> `_Active Plan.md` -> last `_Session Log.md` entry -> the Resume Point's files. Why: fresh reads beat rebuilding context from memory.

**Work:** one issue at a time; context before options; scope loop-worthiness; **plan the whole cycle before branching** (every task, edge case, what is in and out) so work lands in one branch; with >2 units left, plan the rest as one batch (one-question investigators -> small probes -> one plan resolving cross-unit interactions -> one pass). Why: piecemeal planning splits a feature across PRs. **Audit a long branch against the objective:** commits grouped by what they buy the user, overhead named, the cumbersome fix cut.

**End:** the session-end batch (-> "Per-Tracking-File Unique Function") -> ADRs for locked architecture -> the Pre-Compact ritual if near the limit. **Compact after each major task** (a shipped PR or large step into new territory), not for rework of the current step. Why: drift grows with context length.

## Tracking File Size Caps (Hard Limits) {#tracking-file-size-caps}

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

**Whole-file rows are checked every time** - per-line caps do not stop a file tripling. An OVER row is fixed by MOVING the oldest content to `_Archive/` (each moved line verified there), never deleting. A status line carries counts and state, not a blow-by-blow. Why: a capped file stays readable at orientation; an uncapped one is skimmed, then ignored.

## Session Log Compression Pattern {#session-log-compression}

- **Latest 2 sessions** full; **older** compressed to 1-2 lines + pointers. Writing the new entry and moving the now-third one to `_Archive/_Session Log Archive.md` (summary + pointer left) are ONE edit.
- **Invariant:** at most TWO `## Session` entries carry `###` subsections; checked at session end AND orientation (grep `^### `).
- **Format:** `## Session N - <topic> (YYYY-MM-DD)` + `<summary>. -> <pointers> | full detail: <archive link>`.
- **Compression MOVES, never deletes** - a gitignored vault has no git history. Before relying on a safety net a rule names, confirm it exists for THIS file.

Why: the log's job is narrative + latest state; old detail is noise once source-of-truth files hold it.

## Per-Tracking-File Unique Function + Anti-Duplication {#tracking-file-functions}

| File | Unique job | Never contains |
|---|---|---|
| `_Session Log.md` | narrative: WHAT happened WHEN; commit hashes once | checkboxes, next actions, decision lists |
| `_Working Memory.md` | dashboard: WHERE we are | task breakdowns, rationale, risk register |
| `_Master Roadmap.md` | task status: checkboxes ONLY | hashes, rationale, next actions, descriptions |
| `_Active Plan.md` | the exact next action | history, task lists, rationale |

**Anti-duplication:** source-of-truth content (spec / ADR / plan / git log / code) is pointed to, never restated; content several tracking files need lives inline only in its unique-function file ("write it anyway" -> STOP). Why: one item in eight places is eight places to go stale.

**Session-end batch, in order:** Session Log (the depth) -> Working Memory (Last Session + one index line) -> Master Roadmap (boxes only) -> Active Plan (status + exact Resume Point); about 5-10 changed lines beyond the log entry.

**The plan file is the progress record** (chat is not the handoff): a `## Progress` block at its top (current task, done with evidence, next, branch, open questions); tick only against shown evidence, record the measurement not just the verdict, note what would make a done task not done.

### Status Files Rot Silently {#status-files-rot-silently}

Drift concentrates in CATEGORY sections (security, testing, CI, launch readiness), which no session owns. (1) Never mix TASKS (checked by the session doing them) and acceptance CRITERIA (confirmed by an AUDIT at a gate) in one list; label each. (2) Stamp `Last verified against the codebase: YYYY-MM-DD` - an unaudited box is a CLAIM. (3) No descriptions in a status file. Re-verify the boxes at each Pre-PR Deep Sweep and the launch gate. Why: a record with a known error rate gets replaced by memory, which never announces its own.

## Tracking-File Batching {#tracking-file-batching}

Update tracking files ONLY at a real milestone, session end (owner declares), the owner's request, or a completed plan phase - never after each edit. **Always immediate:** source-of-truth files (they are the work), broken references that hurt recovery, new rules here, owner-requested edits. Why: per-step bookkeeping burns context on state that changes minutes later.

**Source-of-truth edits earn their words:** the load-bearing change, one link to the canonical pattern; no audit metadata, restating or redundant citations. Why: a citation that changes nothing a developer does is noise.

## Engineering Decisions Documents (Optional, Public Repos) {#decision-documents}

One outward doc per major phase on WHY its tools and conventions were chosen: Overview / Stack at a Glance / Decisions and Reasoning (per tool: what, why, alternatives, trade-offs, ADR link) / How the Pieces Fit / Standards Adopted / Further Reading / Revision Notes. A hard word cap counted by ONE named tool; trim narrative, never a fact; honest trade-offs; no AI tool references; link, don't restate. Why: unwritten judgment is invisible. <!-- PROJECT ADAPTER A22: location, cap, counter, public style. -->

## Context Engineering Discipline {#context-engineering}

| Failure mode | Mitigation |
|---|---|
| **Poisoning** - an error enters context and is reused | hygiene rituals; direct-read verification of agent claims |
| **Distraction** - context so long it dominates | size caps; earn-their-words edits; just-in-time loading |
| **Confusion** - superfluous context lowers quality | depth in source files; tracking files SHORT + LINK |
| **Clash** - new information conflicts with old | Re-Plan on Failure; ADR supersession (link both ways, never delete) |

**Tool loadout:** past ~20 active tools / skills / servers, curate per task; load deferred tools only when about to use them; child agents get only their narrow toolset. Why: everything unneeded dilutes what matters.

## Pre-Compact and Post-Compact Hygiene Ritual {#compact-ritual}

**Keyword `begin pre-compact`** (standing) runs the Closeout: (1) capture every style / format / workflow correction durably; (2) the scan below; (3) the session-end batch; (4) git verify - branch, HEAD, clean, ahead / behind, local and REMOTE branches (merged -> retire per "Branching"; open or no PR -> report), finished agent worktrees removed; (5) the handoff - in a multi-session project, sent to the coordinating session, then the thread is closed. Why: the next session starts from what the closeout wrote down, so it must be true.

### Pre-Compact Scan {#pre-compact-scan}

0. **ASCII scan** of this session's edits (any non-ASCII byte). 0b. **Comment-label scan** of every touched source file: phase / task / session / ADR labels reworded to the MECHANISM. Emit pass / fail - a check not shown did not happen.
1. **Anti-duplication scan** - hashes in the Session Log only, locks in ADRs, next actions in the Active Plan, statuses in the Roadmap.
2. Audit the Roadmap, dashboard, Active Plan and current log entry against caps and template.
3. **Size-cap table** `| item | words | cap | status |` - the four whole-file rows + every capped line touched - counted, never estimated; OVER rows fixed; done only when the all-`ok` table is shown.
4. **Loop-learnings check** - lessons captured; the handoff names open lessons + any regression.
5. **Temp files** (screenshots, scratch scripts, logs, backups, drafts) that have served are deleted.
5b. **Rule sort for the kit (standing):** each rule, standard or workflow change this session (skills, agent roles, working-style memory too), tagged `project-only` or `portable`; portable ones go to `/methodology-kit fold-back` with the owner, around the compact. Emit the list, or "no rule changes". Why: without this step an improvement stays in one project.
6. Generate the handoff.

### Post-Compact Orientation Protocol (MANDATORY first action) {#post-compact-orientation}

Why: the recurring drift is treating reminders and the summary as a re-read, then claiming "I just re-read".

1. **Fresh Read calls** on every file in the handoff's Reading Order, even when it says "nothing in flight". NOT substitutes: system reminders inlining files, the compaction summary, auto-imported `@file` content, memory.
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
3. Anti-duplication spot-check (2-3 items). 4. ASCII scan. 5. Size-cap table. 6. Log compression check. 7. **Sweep check:** a sub-project COMPLETE without its sweep box, or a branch near a PR without a current report -> sweep first. 8. **Branch check:** work on `main` -> branch first. 9. **Confirm working mode + first action** with the owner before anything beyond Read.

**Anti-hallucination clause:** "I just re-read", "state verified", "the standards confirmed" are FORBIDDEN unless the Read tool ran this session for each file named. No visible checklist = no orientation = no source-of-truth work.

### Handoff Message Structure {#handoff-message-structure}

One self-contained message: any command the owner must run first in its own code block, then one copyable text block:

```
# <PROJECT NAME> - Continuation Handoff

## REQUIRED FIRST ACTIONS
Run the Post-Compact Orientation Protocol in `_Working Standards.md` (fresh reads of the Reading Order,
visible checklist, scans) and confirm mode + first action with the owner. This handoff is a CACHE.

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

## Code Standards {#code-standards}

Additive to the global standards, which hold comment depth, docstrings, constants and script output. Stack, naming, linters and import order live in A6/A7.

- **Size targets:** functions <= 50 lines (100 = refactor signal); UI components <= 250; files <= 500. Why: small units fit context and test easier.
- **Comments** are self-contained for a reader with ONLY the code - no plan / finding / ADR / session / task labels, no history, no restating code. Why: labels add nothing for a cold reader and cost tokens.
- **Comment out, prove, then delete:** prove suspected-dead code or data unused (type-check, tests, probe, build), then DELETE it in the same work (git keeps it; reference material moves to docs first). Only a marked placeholder or `// TODO: <what> - <why not yet>` stays. Why: a comment that makes a reader ask "what is this for?" is debt.
- **ASCII only** in every file (`->`, straight quotes, ` - `); non-ASCII built at run time from code points, never typed as an escape into a tool parameter (it may arrive decoded); every edited file scanned before commit and at closeout. Why: invisible characters break diffs, greps and absence checks.
- No magic numbers. **Match the existing pattern** for the same job (grep the invariant the codebase already enforces). **Literal patterns:** find a value by plain string search, extract with a literal regex - one built from a variable trips static analysis.
- **Embed raw, clean at display:** text both embedded / indexed and shown is cleaned only by a pure display function, never in an id, anchor or search path. Why: edits to embedded text perturb rankings.
- **Errors** throw static opaque codes (`throw new Error('E_SOMETHING')`), never interpolated input; detail goes to the safe logger. Why: input in an error is an injection and leak path. <!-- PROJECT ADAPTER A13 -->

### Size Budgets: Trim Before You Ask {#size-budgets}

Budgets are self-set so only what is necessary ships. When a change would exceed one, the order is fixed:
1. **Look for bloat first** in the over-budget bucket (dead guards, duplicated logic, values never read, eager code needed on demand), MEASURING each saving on the file it touches - even for a small overage.
2. **Prove each removal changes nothing** (the impact test): one trim per `perf:` commit through the full gate; a probe where no test can observe it; a breaking trim is reverted. **Security code is never a trim candidate:** the trim brief is an allow-list of files and functions, each trim commit diffed against it.
3. **Only then request room** with the measured shortfall, what was ruled out, and the proposed number; the owner decides. **Moving bytes between budgets is a request too.**

Never raise a limit to make a run pass. Keep a margin larger than CI's build-to-build drift. Why: a budget that bends on request is not a budget. <!-- PROJECT ADAPTER A12 -->

**One request, two checks (planned work).** A plan that grows a budget asks once, at approval: per line, the estimate + max(10%, the drift floor), landed in one commit. One final check at the PR's last gate, after review fixes: over -> steps 1-3; more room than the margin -> lower to measured + margin. A measurement above the estimate before the raise lands re-sends the request. Why: size stays a decision without a stop per commit, and padding never accumulates.

## Test-Driven Development (TDD) {#tdd}

**Mandatory for every feature and bugfix,** presentational, config and route-shell code included: RED (a failing test for the smallest behaviour, failing for the right reason - a compiling stub, not a 404 or type error) -> GREEN (minimum code) -> REFACTOR. Never defer the testable slice; a plan note deferring a test covers only parts needing unbuilt pieces - else surface the fork to the owner. Why: a test written after the code tests the code, not the requirement.

- **Coverage targets:** pure logic - every branch a caller or bad input can reach; UI - render + interaction + state; boundaries - contract + mocked integration; critical paths - E2E.
- **Exercise failure paths:** force failure / recovery branches and assert the restore (byte-compare), not just an error printed. A feature failing at its first gate has no coverage after it - go look downstream.
- **Verify the output artifact, not just the run:** diff real input -> output and search it for every form of loss; a gate proves only the property it checks, so each property the artifact needs gets its own check. Why: a green run can ship destroyed content.
- **First, per component:** acceptance criteria as test specs, edge cases, failure modes; then tests; then code. **Fixtures look like the data** - derived from real identity rules (the id builder, the slug function) and samples (length, character set, punctuation); shared ones live in one module. Why: tidy fixtures hide the cases worth testing.
- **Separated test teams** (contract with real types -> test agent -> adversarial inspector -> implementer who cannot edit the test) are heavy: foundation logic only (crypto, codecs, state machines, ranking).
- **Layout:** tests beside source (`<source>.test.<ext>`), E2E in `tests/`. <!-- PROJECT ADAPTER A8 -->

### CI Gate {#ci-gate}

**"Green" = every step of every CI workflow file**, not a remembered subset - or name the skipped step and why. Run the FULL local gate before every PR, however small ("reasoned unaffected" is not "ran it green"); copy each command from a full read of the workflow (a folded run block is one command); the exit code is the gate - echo it, never filter output through an invented pattern; re-run the dependency audit before the PR and before merge commands. A test runner may reuse a server already on its port and test a stale build - check who owns it, never kill the owner's. Why: a remembered subset is how red mains happen. <!-- PROJECT ADAPTER A9/A10 -->

### Test and Review Cadence {#test-and-review-cadence}

Why: waiting on decisions and re-running checks cost most of a run's wall time, not the testing itself. How often, never how strict: test first, break check and the full gate before every PR never change.

- **Decide up front:** copy lines and a size-raise band are settled at plan approval; one scheduled check-in per phase; a raise inside the band is not a stop.
- **Commit hook:** lint, format, type check, the whole fast suite, and only the slow (browser) tests related to staged code. Configs, workflows, the lockfile, files outside the source folders, or any deletion run everything. Prove the narrowing with a known-bad control (break a test, see red) before relying on it.
- **Full gate:** once per phase end and before every PR; independent steps run side by side, every step still runs; a fix after an Op-Test re-runs only the touched suites, the PR's final gate covers the rest; E2E may run beside the non-building steps (after type-check sync), never beside a build (shared folders and servers). **Size budgets:** once per batch; bisect only when a line is over.
- **Load guard:** the hook and the gate first run `node .claude/load-guard.cjs` (refuses CPU over 40% averaged over 3 s, naming the busiest processes; `--force` overrides). Why: a starved machine fails tests falsely.
- **Every commit runs the hook,** builder commits included. Why: a unit passing alone can break a sibling once stacked.
- **Team mode:** batch (the main session leads) under about 5 units, orchestrated above. **One review lead** runs the whole tail (sweep, fixes, fix check, re-sweep, op-test, design calls) with one stop.
- **Fix sets:** one checker may do the fix check and the re-sweep together only when the fixes cover at most 2 roots, none above low; otherwise run both. Why: the separate re-sweep catches half-done fixes.
- **Reviewers:** a feature PR keeps the Pre-PR Deep Sweep floor; sizing to stakes applies above that floor and to other PRs. Each is held to its step limit; over is a contract miss. Keep the top model as reviewer until the scoreboard shows a cheaper one holds.
- **Crashes:** a crash failing a step in seconds (access violation, segfault, spawn failure) is logged (date, step, what else ran), not investigated; retry once alone (no other gate, hook or agent test running); after two identical ones propose a restart. A loaded machine times out heavy tests: wait for quiet, never raise a limit.

### Sub-Agent Verification Step {#sub-agent-verification}

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

## Test Integrity (Tests Never Yield to Implementation) {#test-integrity}

**NEVER compromise a test to pass the implementation.** Why: a test that always passes gives false confidence and ships green bugs.

**When a test fails (verification-first):** don't touch the test; (1) dump what the implementation produces; (2) compare to the spec's intent; (3) implementation wrong -> fix it; (4) test wrong (wrong place, outdated detail) -> fix it to the spec's intent, documented. Skipping the dump compromises the test by assumption.

**Allowed:** moving a test's LOOKUP location (assertion unchanged, output verified correct there FIRST); a spec assertion change only after a spec change locked with the owner; diagnostics; a documented platform skip only when the TEST PLATFORM lacks the API (the comment says why and where real coverage comes from). **Forbidden:** weakening an assertion; relaxing a regex; ranges wider than the spec; "close enough"; silent catches around assertions; `.skip()` on a real failure; deleting a "flaky" test without its root cause; moving a lookup unverified.

**Integrity is the line, not immutability.** Maintenance that does not lower what a test proves: (1) raising the bar (new case, tighter assertion, security coverage); (2) realigning an expected value to a LOCKED rename (matcher, strength, intent unchanged) - in a loop only when pre-listed in its contract. **Always a hard halt:** anything that would let genuinely broken behaviour pass. Why: the gap between "test passes" and "code is correct" is where low-effort products live.

## Design for Human Error {#design-for-human-error}

- **Exact-entry fields** (passphrase, code, key) let the person SEE what they entered and find the wrong part: name the error's position; offer a reveal, weighed beside the security cost, with leak guards (masked to keyboards and spell check, copy refused, cleared on hide or lock); ruling it out records why and the human-error cost, for the owner. Why: people who fail blind give up and never return.
- **The human factor:** an option list for a hurdle (lock, code, confirm, required step) answers first: (1) what it protects and its value to a stranger, now and with planned features; (2) the realistic threat, not the worst; (3) what a real person can remember and repeat daily; (4) how someone who forgets recovers. Pick the lightest hurdle covering the realistic threat; the copy says what it does not cover. Why: a hurdle people cannot live with is bypassed or abandoned.

## Test Value (Practical Tests, Not Test Counts) {#test-value}

**Every test names the real use or real failure it guards** - a person on a screen, a caller or agent on an API, an attacker's input, a bug that happened. No answer -> not written. Coverage and counts are signals, never goals. Why: fluff raises counts and upkeep, not confidence.

**Proof by break:** break the code the way a real bug would and show the row that turns red, on an assertion. A row no plausible bug reddens is rewritten or cut; a plausible bug no row catches gets a row.

- **Keep:** behaviour through its user's seam (screen, exported function, protocol), not private helpers; every security / privacy / legal rule and reachable failure path; boundaries, one case each side; a named regression test per real bug; table rows only for distinct branches or real inputs.
- **Cut:** tests restating the code; second proofs; assertions on freely changeable internals; rows reaching no new branch; tests passing against a do-nothing stub (unless a break-checked "nothing happens" check).
- **Checked by:** the break check; builders naming the use of any test beyond the brief; checkers' `test-value` findings (keep / cut / repoint per added or edited test); the sweep's Test Value agent; **fix forward** (cut fluff only in files a PR already touches, when cheap and safe).

## Loop Workflow Mode (Keyword-Gated TDD Loop) {#loop-workflow-mode}

An opt-in overlay for mechanical TDD work, under graduated trust; the default stays manual. Files and visuals only via a pre-agreed **loop contract**.

**Loop-First Scoping (mandatory).** At the start of every substantive task, state the verdict: the mechanical slices (test shape, implementation and commit message all pre-determined) vs the parts needing a choice or a human eye. Not looping is valid; not considering is a miss; never manufacture work to loop. **The bar never moves to fit the loop:** raise it or loop less. Why: the loop offloads grind; it must never buy speed with integrity.

**Self-Correction Boundary - self-correct mechanics, escalate choices.** Self-correct (log the lesson; ~2 attempts): an anchor miss, a typo or wrong import, an API differing from the guess (read the installed types), an under-tested implied branch. Hard stop and escalate even when a fix is reachable: a decision, name, format or style outside the plan; an integrity-LOWERING test change; an off-contract file or unverified visual; a 4th visual increment; a spec / ADR / public-interface change; an unexpected test result; non-convergence; a call for the owner's visual / legal eye; the end of the tasks or the goal. Why: "self-correct more" must never become silent drift.

**State machine.** OFF by default and after every compact. Armed only by the owner's exact phrase **"begin loop workflow"**, after a clean orientation, a learnings scan in Claude's report, an agreed contract (for files or visuals), and the owner's comfort. ANY owner message mid-loop halts it. Why: a persistent keyword outlives the context that justified it.

**Loop contract:** files to create (path, why, the reference it mirrors - any other file = hard stop); visual increments with their LOCKED reference; expected test collisions from a repo-wide search. Each run: a plan before, a LOOP SUMMARY after.

**Per task:** failing test -> shown FAILING for the right reason -> minimal code -> real counts, whole suite GREEN -> one-line `type: subject` commit -> next. Claude runs the test runner and local git; **push is never automated.** Why: a bad loop unwinds locally. **Command environment:** <!-- PROJECT ADAPTER A11: the tool-shell prefix that finds the right runtime with no installs. -->

**Visual-correctness gate.** Tests verify structure, never appearance. After at most **3 visual increments** (any human-facing output) the loop HALTS for a Visual Checkpoint, even when confident; a doubtful visual halts at once; nothing visual reaches the remote unseen. An unreachable state is shown on a throwaway route at narrow and desktop widths in every theme, overflow MEASURED, deleted before the next commit.

```
VISUAL CHECKPOINT - <arc> (<date>) - <N> visual increments since last check
Built:         <increment -> commit>
Expect to see: <what renders, in which states>
How it works:  <the interaction>
Questionable:  <contrast / spacing / color / copy, or "none" only if truly none>
Verify at:     <routes> -> loop HALTED, awaiting your OK
```

**LOOP SUMMARY** (BLUF, real numbers, ~12 lines max - longer means the loop ran too far without a gate):
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

**Learnings + graduated trust.** Capture only behaviour-changing lessons (an owner correction, a plan under-spec, an anomaly + root cause, a near-miss, a visual wrong while green) via `Flags/learnings`; review at every re-arm and phase end; a recurring or systemic one graduates here and is archived. **Repeat = REGRESSION:** hard stop, `REGRESSION: L-NN recurred`, scoreboard bump. Why: corrections falling and regressions at zero is the accuracy signal. While OFF, each manual commit notes that "begin loop workflow" is available for the next loop-worthy chunk.

### Graduated loop lessons {#graduated-loop-lessons}

Standing; a repeat is a regression. Why: each cost a real slip before it graduated.

1. **Find everything a change invalidates, repo-wide, before the first edit** - field 8's "Before the first edit" line, plus tracked public docs; a change to how a value is SHOWN searches for it AS SHOWN. The collision list comes from the scan, never memory.
2. **A test must be able to fail** - fixtures past the threshold (re-derived when it changes); disarm a second guard that could produce the same value; the break check ("Test Value") reddens an assertion, not a crash. A "nothing shown" check right after an action proves nothing; re-prove layout across the real width range.
3. **Never push escapes through a shell or tool parameter** - the Edit tool on fresh bytes, never `sed` or heredocs; prove a check fires (true on a bad character, false on ASCII) before trusting its silence.
4. **Anchor every edit on freshly read bytes** - formatters change bytes; line-scoped directives go where a formatter cannot split them.
5. **Static opaque error codes** slip in new error paths and helpers; check CI-only gates too.
6. **The tool shell's runtime** - see "Command environment".
7. **Never `cd` into a subfolder** - use quoted absolute paths or `git -C`; the only `cd` is to the root.
8. **Stop the preview before any rebuild;** unreachable states: "Visual-correctness gate".

## Spec-Driven Development (SDD) Triangle {#sdd-triangle}

**Spec + tests + code stay in sync;** a change at one vertex examines the other two. Code changed -> spec updated, tests cover it? (else justify in the PR, ADR if structural). Tests changed -> did the spec require it? Spec changed -> plan the drift fix in `_Active Plan.md`. Pre-merge, source changed without spec, ADR or tests gets a why. Why: silent spec drift makes a later session re-implement the old behaviour.

**Locked-Decision Drift Markers.** When code deviates from a locked ADR / spec decision, the SAME session amends every affected location (with a Revision History line), or puts `> SUPERSEDED (<date>): <what changed> - see <pointer>` at EACH one AND logs the pending sync in the plan's "Execution Notes & Deviations". The rewrite may batch, the WARNING may not; markers link forward and never delete the old prose. Why: a reader landing on a stale line will not know to read the plan addendum.

## Security Standards {#security-standards}

Top priority. The baseline, data boundary and platform controls are A3/A4.

- **Baseline:** a named verification standard (e.g. OWASP ASVS Level 2); the data boundary is architectural and tested, not policy; no trackers or analytics unless A5 allows.
- **Secrets:** none in client code or history (env files gitignored; values never printed - key names only; ids masked in diffs); keys never reach the client (a backend proxies); client-held tokens encrypted at rest; committed config uses placeholders. **A dev server may hold live secrets:** scripted walks block every outside-service route before the first page loads, proven by a control (a counter on the handler); read a route's handler for outbound calls before submitting its form. Why: a test run can send real email or spend real money.
- **Per-component checklist:** `_Templates/_Component Security Checklist.md` completed BEFORE a component is complete. Why: security reviewed last is security bolted on.
- **Dependencies:** a scheduled updater; advisories as PRs; no unaudited dependency in a critical path; an unfixable high -> confirm no patch, research removal first, else a scoped documented ignore for that one advisory (only if it cannot reach production) with a retire-when; a minimal lockfile diff after override experiments.
- **SAST** on every PR; high blocks merge; triage within a week; CI-only scanners run locally on changed files before reporting done.
- **Cadence:** a staged-diff scan before every commit (ids, secrets, keys, logging of user input, new data-gathering or egress surface), shown passing; the Pre-PR Deep Sweep before every merge.
- **No usage-scaling cost** without revenue: paid synthesis is bring-your-own-key (encrypted on the client, sent straight to the provider); an operator tier degrades to free with a hard spend cap; no providers that train on prompts.
- **Threat model** in the spec, re-reviewed each major version; novel surfaces get a mini threat model in their component spec.
- **Disclosure:** a published `security.txt` (or equivalent) with a contact and SLA (e.g. acknowledge 48 h, triage 7 days).

## Pre-Commit Discipline {#pre-commit}

Every commit passes the hook (-> "Test and Review Cadence"). **Never `--no-verify`.** One commit per call, foreground, never parallel, output unfiltered to a log; preview servers and test browsers stopped first. After a failure or a killed hook, check the half-state (status, log, stash list, index lock, leftover test processes) before a retry; never chain a commit after a failed one. Why: chained commands run on whatever the failure left staged. <!-- PROJECT ADAPTER A9/A15 -->

### Commit Message Format {#commit-message-format}

One line: `git commit -m "fix: hold the page still behind the open reader"`.
- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`, `perf`; a scope is optional and rare.
- **Subject:** imperative, lowercase, no period, what the change does for a `git log` reader; no task / phase tags or asides. **No body, footer or AI / tool trailer** (detail goes in the PR body, the Session Log and comments). Reaching for `-F`, a heredoc or a second `-m` means the message is already wrong.
- **Check first:** `git log --format=%s -20`; if this section and the log disagree, the log wins and this section is fixed. Why: a documented convention nobody practises misleads every new agent.
- **Enforced** by a `commit-msg` hook + a CI check over the branch's commits. <!-- PROJECT ADAPTER A15 -->

## Branching {#branching}

`main` always shippable; short-lived branches (1-3 days); squash-merge; linear history; PRs for anything non-trivial (review pause + CI).

**Branch names:** `<type>/<plain-kebab-description>` (`feature`, `fix`, `chore`, `test`, `perf`, `security`) in plain words; no internal codes or tool prefixes (`claude/`, `worktree-`); read recent PR branch names first. Why: a branch name is public, like a commit subject.

**Branch-first:** before the FIRST edit to a tracked file for a feature, be on its branch (vault edits exempt), the isolation tier named: a trivial fix may land on `main` where the project allows; a feature gets a branch; major work a worktree. Re-check `git branch --show-current` before committing. **Highest risk: right after a merge** - branching is the first action of any new issue; the tell is proposing a PR from `main`. Why: branching tied to a later step is skipped by work that comes first.

**Retire merged branches, local and remote:** a squash-merged branch looks unmerged (a "gone" upstream is the tell) - confirm an empty `git diff --stat <branch> main`, then force-delete; unset the upstream of a branch deleted remotely on purpose.

## PR Body Standard {#pr-body}

Formats in `_Templates/_PR Body Template.md`: **Standard** for features, design decisions and new behaviour; **Lean** for chores, docs, config, bumps and one-line non-behavioural changes.

- **Hard rules (outward-facing):** ASCII; no AI / agent / tool references (reviews described BY DIMENSION + verdict); no links to gitignored vault docs; value-led title `<Area>: <line>`, H1 = the title.
- **Lean:** 1-2 sentence framing, <= 3 changes (what and why, no file lists), 3 gates (the proof; the full gate as one line; the sweep exemption by dimension), <= 1 sentence of notes.
- **Summary, not tallies:** outward summaries state the end result, and each thing once. No per-step tallies (size raises, finding, test or mutant counts); keep a number only if it is the result or the reader acts on it. Test each line: who reads it, and why care? Detail stays in the sweep report and plan. Why: tallies bury the result.
- **Standard:** before / after table; decisions and review result on screen; file list, gate results and clean checks in folds; total, on-screen and per-bullet ceilings ("wall of text" = on-screen words and bullet length); plain engineer speak.
- **Never inflate a small PR.** The audit script (sections, width, word caps, banned words, ASCII) runs with every body; it cannot see content drift, so keep the conventions of the lived bodies (below; a budget raise states the final old -> new and its basis; a proof gate claims only what ran). Body + audit go to the owner BEFORE any push or PR command. After a trim, reread for flow. <!-- PROJECT ADAPTER A16 -->

**Every outward piece starts from its format:** a PR body, release notes, doc, README or post starts from its template, its rule and the two latest pieces of its kind, and runs its audit; the hand-off names the sources. Prose the owner publishes as themselves avoids AI tells: dash-free (no em dash, no double hyphen), no neat triads or stock phrases. Why: writing from memory drifts the format a little every time.

## Release Notes {#release-notes}

**After every merge that changes what users get, a release follows** the Post-Merge Check.
- **Match the latest release of the same kind** (feature vs quality) - read it first. <!-- PROJECT ADAPTER A17 -->
- **Lead with this release's value**, not the last post's pattern; describe the change from the last release, not unshipped mid-branch states; check every date.
- **Semver:** patch = fixes; minor = new user-facing features; major = breaking; state the reasoning against the version plan (roadmap labels are names, not tags); ask when a run's mix is unclear. One release may cover two same-day merges.
- **Public prose:** plain words - what a user gets, honest limits beside the claims they limit; no tests, tooling, bumps, AI references or vault links (summary, not tallies); each claim audited to the file, test or measurement proving it (a "used to" claim names only states a person could reach; a third-party app claim needs a measurement per app).
- **The owner publishes or approves each publish;** Claude drafts and publishes only on an explicit go. A post accompanies a feature release only, when the owner says so.
- **The work PR carries the version bump** - never a bump-only PR; with several PRs the last to merge carries it; held while the merge date is unknown. The shown version comes from the package file; the audit checks tag == package version.
- **Tag the full SHA CI tested,** never a branch or short SHA. List releases before creating (an existing tag: compare its body with the audited draft); after publishing, read the live body back and diff it.

Why: a release is a public claim, drafted from format and code and published only by the owner.

## Post-Merge Check {#post-merge-check}

After every merge, before the release, verify the live system, each step shown: (1) **the deploy landed** - the live build identifier postdates the merge; (2) **the critical path answers** - one real request returns the expected status and version; (3) **a mismatch is an outage** - tell the owner at once, run the runbook. Retire it when CI does it. Why: hand-deployed parts drift from merge-deployed parts silently. <!-- PROJECT ADAPTER A18 -->

**Deploy config:** a hand-deployed part (a data index, a side service) needs its own upload and redeploy on each version change - write the runbook. A dashboard-only change to a config-file setting drifts back on the next deploy: durable changes go in the config file, secrets in the platform's secret store. Before a hand deploy, diff local config against committed, ids masked. Never roll back past a local-database schema raise (older code cannot open it); fix forward.

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

## Mid-Design Red-Team (Security Before Lock) {#mid-design-red-team}

**Before locking any design touching personal data, encryption, authentication or external surface, red-team it inline.** Why: a design-time flaw is a paragraph of spec; a post-build flaw is a redesign, rebuild and migration.

- **One iteration:** 3 parallel read-only red agents - **Red-A** privacy / data exposure (logs, dev tools, side channels, URLs, caches, workers, errors); **Red-B** crypto / keys (extraction, misuse, KDF weakness, downgrade, lifecycle); **Red-C** app logic (races, state corruption, replay, crafted-input DoS, schema bypass, error states) -> numbered findings with severity -> **White-D** (privacy + crypto patches) and **White-E** (logic + cross-cutting) -> the controller integrates.
- **A safety-critical LLM prompt** gets its own red-team (misattribution, gate evasion, scope, delimiter forgery, refusal) plus a novel-lens slot; some fixes belong in code (structure that makes forgery impossible), not prose.
- **Three iterations,** fresh top-tier agents each; **converged** when the last finds no new whole-mechanism gap (not zero findings); a new one in round 3 -> one more round; another -> back to Plan. Each finding-patch pair is then LOCK (fixable, cost <= value) / DEFER / DOCUMENT-ONLY (inherent) / GOVERNANCE.
- **Scope:** the design, the locked foundation under it (structural findings -> ADR supersession), its integration points. **Apply** to data, crypto, new external surface, or on request; **not** to pure presentation, untouched internals, or property-preserving refactors.
- **Capture** each finding where its patch lives AND in the spec's Security Considerations (finding, severity, fix, status).

## Correction & Learning Loop {#correction-loop}

On an owner correction: **acknowledge** (don't defend); **capture** a specific actionable rule in this file the same session (memory gets a pointer, Kit Standards #3); **sharpen** it if the mistake repeats; **re-read** the section before working in that area. Memory: one file per subject, a line or two per entry, under 3 KB each, one index line per file. Why: a correction living only in chat is re-made next session.

## Kit Standards (How the Methodology Improves) {#kit-standards}

The methodology kit is the baseline every project starts from. These rules keep it current, small and enforced. Each is checked by a machine where one can check it; the check is named.

1. **The kit check runs itself.** `.claude/settings.json` wires `kit-hook.cjs`. Session start: the kit's GitHub ahead of its folder, newer kit rules, kit files this project changed (update skips them), the skills for its cases. Each message: once per kit release made mid-session. Before a compact: rule changes waiting for the kit, the vault backup, plugins past their backup. A failure warns, never stops a session. Why: a check that relies on memory gets skipped. *Check: tests run the hook.*
2. **Rule sort at every closeout.** See "Pre-Compact Scan" step 5b: each rule change is tagged project-only or portable; portable ones go to `/methodology-kit fold-back`, and the owner decides each. Why: methods improve inside projects and are lost unless they flow back.
3. **One home per rule.** A rule lives in this file only. Memory, notes, briefs and tracking files hold a pointer (`-> _Working Standards.md "Section"`), never a restated copy. Why: two copies drift, and the stale one gets followed. *Check: tests flag kit memory lines that repeat this file's wording.*
4. **Briefs read their rules from one source.** Every agent brief tells the agent to read the "Rules every brief carries" block from this file; nobody pastes it. Why: a pasted block goes stale the day a rule changes. *Check: tests read the brief templates.*
5. **Merge and retire at each kit release.** Before a kit version bump, merge overlapping rules, retire rules nothing uses, and keep this file under the kit's size cap. Every rule carries a one-line why. Why: a standards file that only grows stops being read. *Check: tests enforce the size cap and a why in every rule section.*
6. **A slip that happens twice becomes a guard.** The second time the same mistake happens, the fix is mechanical - a hook, a test, a lint rule or a script check - not more text. The `_Loop Learnings.md` scoreboard records each guard added. Why: text is read when someone remembers to; a guard runs every time.
7. **Trial before standard.** A new kit rule ships marked `[trial]` in the CHANGELOG and listed in the kit's `TRIALS.md`. It becomes standard once a second project has used it cleanly, or when the owner promotes it directly. Why: a rule proved in one project may only fit that project.
8. **Skills by case.** The kit's `.claude/kit/skill-cases.json` maps each kind of task to the skills it loads. Each project turns its cases on in `.claude/skill-cases.local.json`; the session-start hook lists those skills. At most two skills per unit of work; design-time, motion and review-time sets stay apart. Why: the right skill unused is no skill, and too many dilute each other. *Check: tests confirm every named skill exists.*
9. **Credit and keep a safe copy.** Each third-party plugin or skill is credited (author, source, license) in `vendor/CREDITS.md` and kept as a pinned backup once its license allows. Read a community skill before first use. Upstream changes enter only through a reviewed `snapshot` and kit bump. Why: credit is owed, and a skill gone upstream must not take the method with it. *Check: tests confirm every backup is credited.*
10. **Back up the vault.** A project's private, gitignored notes (its vault) go to a separate private repo at every pre-compact (`.kit/vault.json`; secret files never copied). The hook commits locally; pushes wait for the owner's go. Why: an untracked folder is one disk failure from gone. *Check: tests prove secrets are never copied and nothing is pushed.*

## Autonomous Fixes {#autonomous-fixes}

**Fix and report:** doc contradictions, stale references, broken links, missing imports, obvious bugs, typos. **Small and easy now:** fixed in the current PR; only large, risky, device-only or design items go to the roadmap, all recorded. **Ask instead:** ambiguous design conflicts, changed requirements touching locks, unclear intent. Why: asking about the obvious wastes the owner's time; deciding the ambiguous takes their decision.

## Failure Response Discipline (Triage Before Fixing) {#failure-response}

Run BEFORE touching code when a test fails, a build breaks, or behaviour surprises. Why: guessing at a mis-triaged failure burns hours and adds worse problems.

1. **Triage:** production bug or test-environment artifact? In scope now or deferred? -> fix / defer / document as residual.
2. **Diagnose with data:** the FIRST action dumps real state (computed values, requests, served bytes, env), not a fix; after 2 failed attempts stop guessing and dump; an unobservable bug is instrumented (an on-screen readout, a log; stripped after) before any fix. A step failing in one second is a script error until its log says otherwise; a CLI's empty error has its cause in its log file; search the roadmap and parking lot for the symptom first.
3. **Verify before push:** run affected suites locally before committing (E2E is often outside the hook); CI / config changes land in the SAME commit as what needs them.

## Enumerate Before You Count {#enumerate-before-you-count}

**A count from a pattern you invented measures the PATTERN** (it fails optimistic). Before a class detector ("junk", "violations") yields a number: (1) print and read every match in context (too many = too broad); (2) report the false-positive RATE, not the total; (3) count distinct matched tokens and neighbours (two findings can wear one number); (4) anchor the rule on what enumeration showed. A capped search is not an absence; a grep finding your own new text is not verification. Why: a speculative count justifies expensive, content-destroying remediation.

### Instruments and Evals {#instruments-and-evals}

**A surprising number is first a claim about the instrument.** Why: a broken harness and a real result look the same until a control separates them.
- **A harness fails pessimistic** (scope too narrow, an early abort): build in a fidelity check; a known-good case must score 100%.
- **Run a control every time:** the instrument must separate known-good from known-bad in THIS environment; storage modes, throttles, runner timings and one-line shell checks are instruments too.
- **An LLM judge prompt is code:** plant known-bad and known-good cases each run and read them first (one sentence can blind it); judge the surface the reader sees.
- **Never compare counts across a changed instrument;** only the within-run paired figure holds. Re-measure after any change to measured code; state corrections plainly, in the code comment too. Before costly rework, run one measurement designed to refute the number.
- **Tune on a TUNE split; gate on a HELD-OUT split frozen before tuning** (deterministic hash split); eval and runtime share code; a coarse knob search. Reporting on tuned data is leakage.
- **Write eval questions from a person's situation,** cold - written backwards from a passage they share its wording and inflate the score; score new items apart from old (a big gap is the tell); never grow the benchmark until the gate passes.
- **Relevance needs per-item curation:** tag matching dumps mostly-irrelevant items; curate 0-3 per host by judgment, guarded by an integrity test.

## Probe Scope {#probe-scope}

**A passed probe proves only what it ran.** List it beside the real use row by row (model, tools, depth, place, length, load, data), each **MATCHED** (run as the real use will), **GATED** (a new probe passes before anything builds on it) or **CANARY** (the first small real run shows it; name what to watch); no row unmarked. Assumptions only a real test can settle are gates that pass first. Ship the de-risked local part first; put the risky integration behind its probes. Why: necessary is not sufficient.

## Snag Response: Least-Invasive Path, No Padding {#snag-response}

After triage and diagnosis: (1) recommend the LEAST-INVASIVE path (no change -> local or config change -> the owner's global environment, last resort, explicit OK); (2) recommend, don't lock - one good option is presented as one; (3) verify the path before asserting it; (4) document snag + fix where it belongs (Session Log, plan notes, `_Loop Learnings.md`, ADR). Why: padding buries the recommendation, and an undocumented snag recurs.

## Justify Every Direction Change {#direction-changes}

When an agreed direction changes, state (1) **why it changed** (the new information); (2) **how it is better** (the concrete difference); (3) **why it is better** (risk avoided, cost saved, quality gained); (4) **a direct reference** (file / line, standard, ADR, precedent, measurement) - never "it is cleaner". Then the owner locks it. Missing any = a **silent pivot**. Why: the owner audits the turn without re-deriving it.

## The Finding Pipeline (Sweep Finding -> Fix) {#finding-pipeline}

**A finding is a HYPOTHESIS, not a work order** (the gates below test it). Why: "read finding -> write fix" makes each fix break the next thing.

- **G1 Triage:** TRUE? (read the code, quote the line; the finding's own quote is not evidence) REACHABLE on an ordinary path? WHICH rule does it break (none = not a finding)?
- **G1a Evidence bar - reproduce it OR quote it.** "Only if it fails" confuses UNREAL with UNOBSERVABLE (memory hygiene has no symptom). Truth = (1) a red test someone watched fail (mandatory when the class is observable), or (2) the quoted line + the hard rule + **an in-repo precedent enforcing that rule on the same class** (none -> backlog, not blocker). Reachability sets severity, not truth. Sweeps produce candidates; **the controller adjudicates**.
- **G2 Diagnose:** the mechanism in one sentence; the violated invariant; `git blame` (ours, or shipped and exposed?). Output: **a named root + a search pattern.**
- **G3 Cluster + search** (BARRIER): group by root; search the WHOLE codebase for each class, shipped code included; fix shared findings at the root (often one token or helper). **Roots get fixed, not findings.**
- **G4 Method:** the CONFIRMED fix with precedent; what it does NOT fix; **which side-effects of the current code it MUST preserve** (watch "moved to a better seam, dropped a side effect"). A fix is new code, most of all when it changes shape: name the failure class it opens (sync -> async: stale writes, unhandled rejections; a lazy seam: not-ready windows, cached rejections) and mirror the codebase's invariant for that shape.
- **G5 Blast radius** (-> the owner's go): files, shipped vs new, public interfaces, other callers, the revert story; a shipped-code fix in a feature branch is scope creep until the owner says otherwise.
- **G6 Fix** - TDD, **one ROOT per commit.**

**Hard rules:** batch at G3 (triage and diagnose everything, then fix roots). **Two passes:** one large sweep, then ONE short re-sweep over the whole batch (never per fix - an undamped loop) of whether the fixes broke anything; a third only for a major re-sweep finding.

### Features First; Findings Ride Inside the PR {#features-first}

1. **A standalone fix PR only for harm:** data loss, a stuck user, a silent outage.
2. **Sweep findings are fixed in their PR**, not only the easy ones; defer only the extremely minor (info, cosmetic, rare path, no harm), each recorded; leftovers go to the next focused PR touching that code or a fix sweep - the owner decides.
3. **Then features;** roadmap fixes ride a feature PR that touches their code; folded-in findings go in the before / after table.
4. **A run's order:** the owner picks the feature FIRST (even when a handoff lists fixes ahead); leftovers and recorded carry-overs are built on its branch (unless large, risky, device-only or a design call); ONE large sweep after both, the short re-sweep, one PR. The Resume Point names the feature pick first.

**Value check:** tier remaining work by what a user would notice (high: someone hits it; medium: keyboard or screen-reader correctness; low: millisecond races, byte trims, test hygiene), say the tier at each checkpoint, and recommend stopping when reviews return ever smaller things, before the owner asks; the value lens ends the loop, not fatigue. Why: a sweep generates work faster than value.

## Re-Plan on Failure {#re-plan-on-failure}

When work shows a locked decision is wrong: **STOP**; flag "this conflicts with [decision / ADR]"; assess what depends on it; present options (unlock and re-lock if needed), the root fix scaled to stakes first-class beside any work-around; then resume. Why: items built on a flawed foundation cascade.

## Simplicity Lens {#simplicity-lens}

Before locking: *"Is there a simpler version with the same outcome?"* Complexity is earned; 3 lines beat 30; no over-engineering for under-1% edge cases or problems users won't meet - but never simplify away depth that creates real capability. Why: every piece of complexity is paid for in every later change.

## Dual-Horizon Recommendations {#dual-horizon}

Judge every recommendation on **current-version fit** (scope, locked architecture, Simplicity Lens) and **end-state fit** (the finished product per roadmap and spec): what it commits us to; which horizon it wins; the **rework cost** if they differ; **accepted debt** (documented, or a compounding trap); impact now and later. Agreed horizons -> one line. A pick a future version will FORCE to change is TEMPORARY; "durable" is defended by its mechanism.

**Temporary-fix gate:** name the robust built-once option and quantify the delta (work now vs the later forced change + risk); temporary only when robustness is disproportionate AND the later change cheap, isolated and non-compounding - recorded as debt with its retirement trigger; otherwise robust. **Build seam-first:** inject the dependency a later mode will swap (local vs server), so the later arc is additive. Why: the cheap-now pick, taken by reflex, is paid repeatedly.

## Success Charter (Define Success Before Building) {#success-charter}

The five-part charter and its three rules live in the global standards; write it BEFORE differentiator or high-uncertainty work. Here, the tiers ARE the Dual-Horizon horizons. Why: work without a defined bar is never done, or never good enough.

## Milestone Project Sweep (Periodic Multi-Agent Audit) {#milestone-sweep}

A MECHANICAL GATE with a checkable done-condition, run under an approved Swarm Contract (as is the red-team). Why: a sweep without a clear trigger never happens.

**Triggers:** (1) **before any substantive PR to `main`** (new behaviour or surface, security / privacy / legal relevance, a sub-project; when unsure, swarm) - the Pre-PR Deep Sweep; trivial chore / docs / one-line PRs get a light pass or a stated exemption; (2) **mid-build** when an arc adds a runtime dependency or external data flow; (3) a **launch-gate sweep** of EVERY surface before any public major version.

**Done iff** a report exists at `<sweep folder>/YYYY-MM-DD-<milestone>.md` with date, milestone, branch / commit; each dimension PASS or with findings; every high / critical dispositioned (`FIXED <commit>` / `DEFERRED <where>` / `ACCEPTED <why>`); for the deep tier, "still aligned with the version goals? YES/NO + evidence". <!-- PROJECT ADAPTER A22 -->

**Six fixed dimensions:** (1) privacy / data boundary - runtime leaks, third-party calls; (2) supply chain + bundle - dependency risk, build scripts, budgets; (3) legal / content + licenses (A2), citation fidelity; (4) code security + pattern consistency; (5) gaps + scaling - untested paths, deferred-now-load-bearing items, scale assumptions, new-test value; (6) version goal alignment - scope creep, drift from locks, overbuilding (the verdict). Plus any milestone-specific one; read-only reviewers per dimension -> a report grouped by when to act.

### Pre-PR Deep Sweep {#pre-pr-deep-sweep}

Why: a solo builder reviewing their own diff sees what they meant, not what they wrote.
- **Adversarial vulnerability swarm:** >= 3 top-tier security agents with DISTINCT angles.
- **A Test Value agent** ruling keep / cut / repoint on every added or edited test (the use guarded, a break check where in doubt); retired when reviews stop finding fluff.
- **Every high / critical independently re-checked** - an input to the controller's adjudication. **Dimension 6 mandatory.** **Covers the branch HEAD** - an older report does not count; re-run or sweep the delta.
- **Anti-hallucination clause:** satisfied ONLY by the agents actually running THIS session AND the report existing with their findings, dispositions and verdict - never by the controller's read, a recalled sweep, or "it looks fine". No report -> no PR.

### Pre-Push Op-Test {#pre-push-op-test}

Before a major or user-facing PR is pushed, USE the product on the production build at the PR head, served locally:
- **The lead's walkthrough:** every spec flow at desktop and narrowest width, every theme and engine, console watched, screenshots to the owner (scripted where the pane cannot load it).
- **Break-it testers** (mid tier, default three, one angle each - e.g. input order / rapid taps / date edges; tabs / locks / reloads / offline; keyboard / screen reader / zoom / forced colors), throwaway scripts in their own scratch folders, read-only on the repo, each finding with a reproducing script.
- **A live checklist** the owner watches: ticked as items pass, notes from both sides, overall status; the last run archived before reseeding; a closing debrief; the owner may hand the rest of a walk to the lead.
- **Findings go through the Finding Pipeline before the push** ("push now, fix later" is the owner's call). Docs / chore / test-only / one-line PRs exempt (stated); small PRs may run the walkthrough only, on the owner's call.

Satisfied ONLY by the walk and testers running this session with results in the sweep report. Why: a green gate and two sweeps still miss what a minute of real use finds.

### Preview Test Before Merge {#preview-test}

A user-facing PR is used on the host's own build of the branch before merge, on the device the stakes call for (below): open the link yourself first; made-up details only; nothing sent (previews may hold live secrets: -> Security "Secrets"). Why: the production platform and a real device are what local tests cannot imitate. <!-- PROJECT ADAPTER A19/A20 -->

**Who tests the preview, by stakes.** Every user-facing PR: the lead checks the deployed preview in phone and desktop emulation (headers, security policy, workers, layout), shown as shots. The owner's real device only for: a new or often-used surface; touch, keyboard or installed-app behaviour; device-only paths (downloads, file imports, sharing); screen-reader checks. Why: emulation cannot prove a device's fonts, system UI, keyboard or storage, so the owner's time goes where only a hand can tell.

### Visible Tracking {#visible-tracking}

`_Master Roadmap.md` carries `- [ ] Milestone sweep recorded -> <report>` per sub-project; **no sub-project is COMPLETE until it is checked**; orientation step 7 checks both. Why: a gate nobody can see on the roadmap is a gate the next session skips.

## Parking Lot + Pre-PR Idea Triage {#parking-lot}

- **Capture** (zero friction): one line under `## Parking Lot` at the top of the active plan - `- <idea> - <where noticed> - hunch: now | next`. No decision, no action.
- **Triage** after all gates pass, BEFORE the deep sweep: **Now** (small, in spirit, cuts churn; growing scope needs the owner's lock) -> built and swept in this PR; **Next** -> one line + pointer in the Roadmap; **Drop** -> deleted with a one-line why.
- **Done** when the lot is **empty** before the sweep; non-empty = the gate was skipped.

**Pipeline:** `build -> all gates green -> Parking Lot triage -> Pre-PR Deep Sweep -> fixes + re-sweep -> gate -> Pre-Push Op-Test -> fixes + gate -> PR body + audit to the owner -> push + PR (owner) -> preview test -> merge (owner) -> Post-Merge Check -> release (owner's go)`. Why: a "now" idea is built and swept inside the same coherent PR; an IDEA is distinct from a FINDING (a defect).

## Recovery Protocol {#recovery-protocol}

Read the Session Workflow start files in order; resume from the first OPEN issue. Re-read Collaborative Design Locks; never reconstruct decisions from memory; a pasted handoff line sets the scope exactly. Why: decisions rebuilt from memory come back subtly different.

## Project Adapter (FILL-IN TEMPLATE) {#project-adapter}

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

## What This File Is Not {#what-this-file-is-not}

Not the design spec (A22), not the roadmap (`_Master Roadmap.md`), not the history (`_Session Log.md`). It is HOW we work. When in doubt about which file to read: this one first.
