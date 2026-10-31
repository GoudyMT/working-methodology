---
id: tracking-and-handoff
load: files
paths:
  - "_Session Log.md"
  - "_Working Memory.md"
  - "_Active Plan.md"
  - "_Master Roadmap.md"
when: Before a compact or session end, after a compact, and when a tracking file is opened.
tags:
  tracking-file-size-caps: size limit, too long, line limit, log length, tracking files
  session-log-compression: compress, old entries, history, log
  tracking-file-functions: tracking files, duplicate, restate, pointer, one job
  status-files-rot-silently: stale, out of date, status
  tracking-file-batching: when to update, batch updates, milestone
  decision-documents: decisions, public repo, engineering notes
  compact-ritual: compact, compaction, closeout, end of session
  pre-compact-scan: before compact, scan, closeout checks
  post-compact-orientation: after compact, resume, re-read, orientation
  handoff-message-structure: handoff, continuation, summary, next session
---

# Tracking Files and Handoff

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

**The plan file is the progress record** (chat is not the handoff): a `## Progress` block at its top (current task, done with evidence, next, branch, open questions); tick only against shown evidence, record the measurement not just the verdict, note what would make a done task not done. **Each step names its check before it starts** (`<step> -> verify: <the test, command or measurement>`). Why: a step with no named check is done when someone says so.

### Status Files Rot Silently {#status-files-rot-silently}

Drift concentrates in CATEGORY sections (security, testing, CI, launch readiness), which no session owns. (1) Never mix TASKS (checked by the session doing them) and acceptance CRITERIA (confirmed by an AUDIT at a gate) in one list; label each. (2) Stamp `Last verified against the codebase: YYYY-MM-DD` - an unaudited box is a CLAIM. (3) No descriptions in a status file. Re-verify the boxes at each Pre-PR Deep Sweep and the launch gate. Why: a record with a known error rate gets replaced by memory, which never announces its own.

## Tracking-File Batching {#tracking-file-batching}

Update tracking files ONLY at a real milestone, session end (owner declares), the owner's request, or a completed plan phase - never after each edit. **Always immediate:** source-of-truth files (they are the work), broken references that hurt recovery, new rules here, owner-requested edits. Why: per-step bookkeeping burns context on state that changes minutes later.

**Source-of-truth edits earn their words:** the load-bearing change, one link to the canonical pattern; no audit metadata, restating or redundant citations. Why: a citation that changes nothing a developer does is noise.

## Engineering Decisions Documents (Optional, Public Repos) {#decision-documents}

One outward doc per major phase on WHY its tools and conventions were chosen: Overview / Stack at a Glance / Decisions and Reasoning (per tool: what, why, alternatives, trade-offs, ADR link) / How the Pieces Fit / Standards Adopted / Further Reading / Revision Notes. A hard word cap counted by ONE named tool; trim narrative, never a fact; honest trade-offs; no AI tool references; link, don't restate. Why: unwritten judgment is invisible. <!-- PROJECT ADAPTER A22: location, cap, counter, public style. -->

## Pre-Compact and Post-Compact Hygiene Ritual {#compact-ritual}

**Keyword `begin pre-compact`** (standing) runs the Closeout: (1) capture every style / format / workflow correction durably; (2) the scan below; (3) the session-end batch; (4) git verify - branch, HEAD, clean, ahead / behind, local and REMOTE branches (merged -> retire per rule:branching; open or no PR -> report), finished agent worktrees removed; (5) the handoff - in a multi-session project, its full text sent as ONE message to the coordinating session (a Claude project thread: `send_message` to `@parent`), never a file path; done only when the coordinator confirms it received the text, then the thread is closed. Why: the next session starts from what the closeout wrote down, so it must be true.

### Pre-Compact Scan {#pre-compact-scan}

0. **ASCII scan** of this session's edits (any non-ASCII byte). 0b. **Comment-label scan** of every touched source file: phase / task / session / ADR labels reworded to the MECHANISM. Emit pass / fail - a check not shown did not happen.
1. **Anti-duplication scan** - hashes in the Session Log only, locks in ADRs, next actions in the Active Plan, statuses in the Roadmap.
2. Audit the Roadmap, dashboard, Active Plan and current log entry against caps and template.
3. **Size-cap table** `| item | words | cap | status |` - the four whole-file rows + every capped line touched - counted, never estimated; OVER rows fixed; done only when the all-`ok` table is shown.
4. **Loop-learnings check** - lessons captured; the handoff names open lessons + any regression.
5. **Temp files** this session made (PR bodies, release drafts, screenshots, scratch scripts, logs, backups, drafts) that have served are deleted wherever they sit: the scratch folder, untracked files in the repo, and any shared or uploaded copy (a project library, an attachment folder). Emit the list deleted, or "none". Why: a served draft left in a shared place gets attached again as if current.
5b. **Rule sort for the kit (standing):** each rule, standard or workflow change this session (skills, agent roles, working-style memory too), tagged `project-only` or `portable`; portable ones go to `/methodology-kit fold-back` with the owner, around the compact. Emit the list, or "no rule changes". Why: without this step an improvement stays in one project.
6. Generate the handoff.

**How: the closeout skill** (steps, two example handoffs, the handoff audit).

### Post-Compact Orientation Protocol (MANDATORY first action) {#post-compact-orientation}

Why: the recurring drift is treating reminders and the summary as a re-read, then claiming "I just re-read".

1. **Fresh Read calls** on every file in the handoff's Reading Order, even when it says "nothing in flight". NOT substitutes: system reminders inlining files, the compaction summary, auto-imported `@file` content, memory.
2. **Visible checklist:**
   ```
   Post-Compact Orientation Protocol:
   [x] _Start Here.md - reading order matches handoff
   [x] AGENTS.md - Edit Discipline + the module index intact
   [x] _Loop Learnings.md - N open lessons, 0 recurred
   [x] _Working Memory.md - Last Session = N, Resume Point = X (matches handoff)
   [x] _Active Plan.md - Resume Point = Y (matches handoff)
   [x] _Session Log.md latest entry - last session was Z (matches handoff)
   [x] <plan / spec / ADR named by the Resume Point>
   [x] Not counted as reads: compaction summary, system reminders, memory
   ```
   Each line confirms a match or flags a discrepancy.
3. Anti-duplication spot-check (2-3 items). 4. ASCII scan. 5. Size-cap table. 6. Log compression check. 7. **Sweep check:** a sub-project COMPLETE without its sweep box, or a branch near a PR without a current report -> sweep first. 8. **Branch check:** work on `main` -> branch first. 9. **Confirm working mode + first action** with the owner before anything beyond Read.

**Anti-hallucination clause:** "I just re-read", "state verified", "the standards confirmed" are FORBIDDEN unless the Read tool ran this session for each file named. No visible checklist = no orientation = no source-of-truth work.

### Handoff Message Structure {#handoff-message-structure}

One self-contained message: any command the owner must run first in its own code block, then one copyable text block:

```
# <PROJECT NAME> - Continuation Handoff

## REQUIRED FIRST ACTIONS
Run the Post-Compact Orientation Protocol (rule:post-compact-orientation; fresh reads of the Reading Order,
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
1. _Start Here.md  2. AGENTS.md (esp. new rules)  3. _Loop Learnings.md  4. _Working Memory.md
5. _Active Plan.md  6. Last Session Log entry  7. (spec / ADR / plan for the next issue)

## Next Step (REQUIRED)
- What:  - Why:  - Source: Active Plan Resume Point; Roadmap milestone advanced
- Deviation (if any): what changed from the plan-of-record + why

## Anti-Hallucination Discipline
- Every claim verified by file read; vault state wins over this handoff.
```
