```text
# Recipe Planner - Continuation Handoff

## REQUIRED FIRST ACTIONS
Run the Post-Compact Orientation Protocol (rule:post-compact-orientation; fresh reads of the Reading Order,
visible checklist, scans) and confirm mode + first action with the owner. This handoff is a CACHE.

## Working Mode: Plan (default)

## State Snapshot
- Current component / version: v2.4.0 live (feature release: the live check, a data date on About, cooking class
  links).
- Locked this session:
  - The live check: CI runs one fixed public search after every push to main, weekly and on demand, and fails
    if results come from the wrong recipe index -> docs/plans/2026-05-30-clean-stop.md (Progress)
  - The owner's calls: D1-D4 as recommended; Resources wording A; a size raise ("raise ok"); accessibility items
    split to a Roadmap box.
  - The manual post-merge online check is retired; the live check replaces it (rule:post-merge-check).
- Open issues: the polish backlog review (focus item 2) is half done - 41 boxes moved to the Roadmap "Known
  issues", 26 still to sort.
- Git: on main at 9f3c0d62 (#81 squash), clean; no open PRs. The live check's first run on main passed (waited
  ~90 s for the deploy, index 1.0.4).

## Newly-Established Working Standards
- None this session.

## Critical In-Flight Context (do NOT lose)
- Decisions awaiting the owner: for the remaining 26 boxes, "member-facing" vs "developer-only" for the 6 that
  touch the import screen (my lean: member-facing; each shows on a screen a user opens).
- Corrections caught mid-session: the PR body came in at 744 words; the owner cut it to end results (544). Lead
  with what changed for the user; process goes in the folds.

## Reading Order (mandatory, in order)
1. _Start Here.md  2. AGENTS.md  3. _Loop Learnings.md  4. _Working Memory.md
5. _Active Plan.md  6. Last Session Log entry  7. _Master Roadmap.md "Known issues"

## Next Step (REQUIRED)
- What: finish focus item 2 - sort the last 26 polish boxes into "Known issues" (member-facing, device-only,
  developer-only) and close the shipped ones with their evidence.
- Why: the focus list runs top to bottom, and item 3 (the download stall guards) is planned against a clean
  Roadmap.
- Source: _Active Plan Resume Point; Roadmap milestone "Self-running maintenance" advanced.
- Deviation (if any): none.

## Anti-Hallucination Discipline
- Every claim verified by file read; vault state wins over this handoff.
```
