Run this first (PowerShell; removes the sweep's throwaway worktree folders, which only you can delete):

```
Remove-Item -Recurse -Force C:\sw1, C:\sw2, C:\sw3, C:\sw4, C:\sw5; if ($?) { git worktree prune }
```

```text
# Field Notes - Continuation Handoff

## REQUIRED FIRST ACTIONS
Run the Post-Compact Orientation Protocol (rule:post-compact-orientation; fresh reads of the Reading Order,
visible checklist, scans), then state mode + first action and start it (ask the owner only if this
handoff and the work order name none). This handoff is a CACHE.

## Working Mode: Plan (default)

## State Snapshot
- Current component / version: v3.2.1 live (quality release: download stall guards).
- Locked this session:
  - The stall guards: a download that goes silent gives up after 30 s and lands on the failure path the app
    already has; a slow download is never cut -> docs/plans/2026-06-09-download-stall-guards.md (Progress)
  - Sweep report filed before the PR -> docs/sweeps/2026-06-09-download-stall-guards.md
- Open issues: none on this branch. Five follow-ups moved to the Roadmap "Known issues" (offline search setup
  unbounded, Feedback send, import caps, the abandoned page request, map index fetches).
- Git: on main at 5e0a7c19 (#88 squash), clean; no open PRs; feature branch deleted local and remote.
  Vault backup NOT pushed (needs the owner's go).

## Newly-Established Working Standards
- Size budgets: one size request per plan, estimate + max(10%, 40 B) per line, and one end check that trims or
  lowers (rule:size-budgets).
- Preview test by stakes: automated phone and desktop emulation by default; the owner's phone only for a big,
  touch, device-only or screen-reader change (rule:preview-test).

## Critical In-Flight Context (do NOT lose)
- Decisions awaiting the owner: whether to automate size increases (the owner asked to explore it first).
- Corrections caught mid-session: none new.
- Decided alone (reported): the map-area cancel on leaving the Map page dropped (it would discard the offline copy
  the worker keeps - the impact test's "lose value"); a timed-out photo viewer load stays in the loader's memo.

## Reading Order (mandatory, in order)
1. _Start Here.md  2. AGENTS.md (esp. the two new rules above)  3. _Loop Learnings.md  4. _Working Memory.md
5. _Active Plan.md  6. Last Session Log entry  7. docs/plans/2026-06-09-download-stall-guards.md (Progress)

## Next Step (REQUIRED)
- What: explore automating size increases (options with effort and rule fit, then stop for the owner's pick).
- Why: the owner named it next; each size request this cycle cost a round trip for a number the build already knew.
- Source: _Active Plan Resume Point; Roadmap milestone "Self-running maintenance" advanced.
- Deviation (if any): focus item 4 (the export formats) waits one step behind this exploration, by the owner's
  call at session end.

## Anti-Hallucination Discipline
- Every claim verified by file read; vault state wins over this handoff.
```
