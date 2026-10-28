---
name: closeout
description: Run the pre-compact closeout - capture corrections, run the pre-compact scan, batch the tracking files, verify git, and write the continuation handoff. Use when the owner says "begin pre-compact", before a compact or a session end, or when a handoff for the next session is needed. Serves rule:pre-compact-scan.
---

# Closeout

Serves rule:pre-compact-scan and the ritual in rule:compact-ritual, which lists the closeout's five parts. The
next session starts from what this writes down, so every line must be true when it is written.

## Steps

1. **Capture** every style, format or workflow correction from this session where it lasts (rule:compact-ritual).
2. **Run the scan** below, step by step, each shown pass or fail.
3. **Batch the tracking files** at the session end (rule:tracking-file-batching).
4. **Verify git:** branch, HEAD, clean, ahead or behind, local and remote branches, finished agent worktrees
   removed (rule:compact-ritual, part 4).
5. **Write the handoff** in the shape below, run `node <this skill's folder>/audit.mjs <handoff.md>`, and fix
   every fault. In a project with several sessions, send it to the coordinating session, then close the thread.

## The scan

0. **ASCII scan** of this session's edits (any non-ASCII byte). 0b. **Comment-label scan** of every touched source file: phase / task / session / ADR labels reworded to the MECHANISM. Emit pass / fail - a check not shown did not happen.
1. **Anti-duplication scan** - hashes in the Session Log only, locks in ADRs, next actions in the Active Plan, statuses in the Roadmap.
2. Audit the Roadmap, dashboard, Active Plan and current log entry against caps and template.
3. **Size-cap table** `| item | words | cap | status |` - the four whole-file rows + every capped line touched - counted, never estimated; OVER rows fixed; done only when the all-`ok` table is shown.
4. **Loop-learnings check** - lessons captured; the handoff names open lessons + any regression.
5. **Temp files** (screenshots, scratch scripts, logs, backups, drafts) that have served are deleted.
5b. **Rule sort for the kit (standing):** each rule, standard or workflow change this session (skills, agent roles, working-style memory too), tagged `project-only` or `portable`; portable ones go to `/methodology-kit fold-back` with the owner, around the compact. Emit the list, or "no rule changes". Why: without this step an improvement stays in one project.
6. Generate the handoff.

## The handoff

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

## The audit

`audit.mjs` checks the handoff: every section of the shape above, in order; the first-actions section names the
orientation protocol; the Git line and the Next Step are filled in; ASCII only. It cannot check that the state
is true; the scan and the git verify do.

## Examples

- [examples/handoff-a.md](examples/handoff-a.md) and [examples/handoff-b.md](examples/handoff-b.md) - two
  handoffs written at a closeout, adapted from real ones with the product, names and numbers replaced.
