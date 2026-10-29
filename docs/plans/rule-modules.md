# Plan: rule modules (kit 0.7.0 -> 1.2.0)

Approved by the owner on 2026-10-28. The full reasoning, the module map and the risk table were reviewed in the
"Kit Rule Modules Build Plan" doc; this file is the progress record from here on. Tick a line only against
shown evidence (test output, measure output, a commit).

## Goal

A session loads the rules it needs and no more. Every rule of 0.7.0 stays and can be found. Any AI can read the
core (AGENTS.md). Agents start with their rules and lose access they do not need.

## Decided at approval

- Module map: a core (written out as AGENTS.md) plus 11 modules - tracking-and-handoff, testing, agent-teams,
  reviews-and-findings, git-and-release, loop-mode, evidence-and-failures, security, kit-standards,
  design-and-ux, code, project-adapter. Planning rules (Success Charter, dual-horizon) sit in the core.
- Caps: AGENTS.md <= 28,000 bytes; each module <= 14,000 bytes; session start <= 45,000 bytes.
- Versions: 1.0.0 for Phase 1 (install changes, so major), 1.1.0 for Phase 2, 1.2.0 for Phase 3.
- Pointer form: `rule:<id>`, resolved through the index.
- Source stays tool-neutral; install writes Claude Code files only for now.

## Execution approach

One session runs every phase in order; the split needs one hand. Agents only where they pay off: one
independent reviewer per phase reads the ledger, coverage report and diff cold; a scanner cross-checks the
pointer inventory in Phase 1. Related tests at each commit; full suite, scrub and measure at each phase end.
One unit, one commit. Nothing pushed, tagged or installed over the main project's tools without the owner's go.

## Progress

### Phase 0: prepare

- [x] Restore point: 0.7.0 pushed, tag v0.7.0 on GitHub (`git ls-remote --tags origin` shows v0.7.0).
- [x] Measure command: `kit.mjs measure` (commit 36a9c4e; 37 tests pass).
- [x] Recall questions approved by the owner and frozen (2026-10-28).
- [x] Baseline run on 0.7.0 and a no-rules control run, saved after the owner signed the CLI in (first attempt
      in (every answer read "Not logged in"); the empty runs were discarded and the runner now stops on a failed
      session. Runs once the owner signs the CLI in.
- [x] Lookup questions written (`docs/evals/lookup-questions.md`).

### Phase 1: rule IDs and modules (plans B and A) - release 1.0.0

- [x] IDs on all 70 headings outside code blocks; uniqueness test (febb2e9).
- [x] Ledger -> `docs/migrations/1.0.0-ledger.md` (6f88839); a test checks it against where rules live now.
- [x] Pointers: 161 pointers (137 in memory) to `rule:<id>`; link-check test (3522367). It found one pointer
      already broken in 0.7.0 ("Locked-Decision Drift Markers", fixed to rule:sdd-triangle).
- [x] Find with tags; index freshness through the build test; find fixtures (6242c68). Lookups: 8 of 10 in the
      top 3 (was 5 of 10 before tags). Caveat: the same author wrote the questions and the tags, so this is not a
      clean held-out number; copied query phrases were removed from the tags.
- [x] Split, move only (c2ecd69); conservation test proved by a lost-line and a copied-line control;
      `docs/migrations/1.0.0-coverage.md`: 0 lost, 0 duplicated, 16 reworded and 1 added line, each recorded.
- [x] Build step (4a922f7): AGENTS.md, .claude/rules, standards/, INDEX.md; CLAUDE.md imports resolve; kit
      hook names the orientation rule after a compact (1db0643); build-freshness test.
- [x] Retired files (7907361), project and user; the old file waits until AGENTS.md lands (0307229).
- [x] Old-layout fold-back, fixture test; run on the main project as a report: 22 sections differ (e1ce078).
- [x] Tests that read the standards read all modules; brief templates carry both pointer forms.
- [x] Kit Standards #3-#5 and new #11, start files, templates and guides (9163fc3, 218e882).
- [x] Install check without Claude: a real 0.7.0 install upgrades cleanly; the old file retires, or stays and is
      reported when edited.
- [x] Live checks in Claude Code: AGENTS.md loads; the testing module loads only after a test file is read
      (`docs/evals/results/live-checks-1.0.0.md`).
- [x] Independent review: 8 findings (2 medium, 6 low); all acted on (0307229, c8cefe1) except headroom, now
      469 bytes under the cap. The short re-check found 3 small gaps (an empty retired map, the memory path in
      the keep check, one quoted pointer); all fixed.
- [x] Gate met: 0 lost or duplicated, 0 broken pointers, 56 tests green, session start 44,531 bytes, recall
      10/10 vs baseline 9/10 and control 0/10, scored blind (`docs/evals/results/recall-scores.md`).

Deviation: the plan doc counted 11 modules; the map it approved has 12 besides the core (project-adapter was
always its own row). Nothing moved between modules.

- [x] Released: 1.0.0 pushed and tagged v1.0.0 on the owner's go (2026-10-28); installed into ~/.claude (4 files
      updated, 0 skipped) while the main project was paused.

### Phase 2: agent access (plan D) - release 1.1.0

- [x] Tools check: each role, foreground and background, records its real tools and what rules it sees
      (f0ca1e9, `docs/evals/results/agent-tools-check.md`): every role got its allowlist; none sees the core rules.
- [x] Role table in agent-teams (c523ce4).
- [x] Builder and checker rules as preloaded skills: builder-rules 6,431 bytes, checker-rules 7,785 (c523ce4);
      live, the builder's context holds "# Builder Rules".
- [x] Guards: builder edit fence, checker clean-tree stop, git pre-push hook (1485cda, 789823f), each with a
      known-good and known-bad unit test. Live in Claude Code (4798177): the fence blocked an off-list file and
      let a listed one through; the checker's stop caught a file it wrote and the checker restored it. The unit
      list moved into the worktree's git folder so it is never committed (727ec24).
- [x] Role-table test; briefs cite rule IDs, the unit list and the push go (727ec24).
- [x] Independent review: 8 findings (4 high, 2 medium, 2 low); 7 fixed with a failing test each (cf75850), 1
      kept by design (the retired conservation test); one short re-check found nothing broken. A live rerun
      added one small fix (40e0a95).
- [x] Gate: guards proved with known-good and known-bad controls; 71 tests green; recall 9/10 >= baseline 9
      (`docs/evals/results/recall-scores.md`). Bumped to 1.1.0.
- [x] Pushed and tagged v1.1.0 on the owner's go (2026-10-28); installed into ~/.claude (4 created, 4 updated).

### Phase 3: formats as skills (plan C) - release 1.2.0

- [x] Six skills (PR body, release notes, closeout, preview test, sweep, ADR) in the open SKILL.md format, each
      with steps, examples adapted from real pieces and an audit with good and bad controls (bc83d34).
- [x] ~~Move only~~ -> **rules stay in the modules** (the owner's call, 2026-10-28, option A): moving put
      must-haves where only Claude Code reads them; the review found it and recall lost a sweep detail. Skills
      point to their rule; the coverage test now proves no 1.1.0 line was lost or copied into a skill (ebcdebe).
- [x] Spec checks: names, description <= 1,024 characters, SKILL.md < 500 lines, live rule IDs, the module
      naming its skill; the push guard names the PR body skill to Claude (additionalContext).
- [x] Live trigger check: a plain "write the PR description" request loaded the skill, and its audit ended
      PASSED (`docs/evals/results/live-checks-1.2.0.md`).
- [x] Sweep tiers (the owner's ask, 2026-10-28): feature, fix, triage, launch gate, with modifiers; the sweep
      audit holds a report to its tier (ebcdebe, 203742b).
- [x] Independent review: 8 findings, all fixed (ddc9a43); one short re-check: 3 wording clashes with the tiers
      and 1 audit gap, fixed (203742b).
- [x] Gate: 86 tests green, coverage holds, session start 44,610 bytes, recall 9/10 = 1.1.0 under one scorer.
      Bumped to 1.2.0.
- [x] Pushed and tagged v1.2.0 on the owner's go (2026-10-29); installed into ~/.claude (24 files created).

## Risks covered (one line each; the check runs before the release that could cause it)

1. Text lost or reworded -> line conservation vs v0.7.0. 2. Text duplicated -> the same test counts once.
3. Handoff template split -> code-block-aware parser, byte-identical block. 4. Broken pointers -> link check.
5. Module never loads -> core index lines, recall test, live path-rule check. 6. Caps -> size tests.
7. Old and new both load -> retired files. 8. Hand edits to outputs -> source header, freshness test.
9. the main project fold-back -> old-layout mapping. 10. Agent changes reach the main project -> scratch batch, project wins,
install between batches. 11. Background tool loss -> tools check first. 12. Agents skipping CLAUDE.md ->
preloaded rules. 13. Guards block good work -> known-good controls. 14. Skill does not trigger -> push guard
names it. 15. Tools change -> adapters name their docs, re-checked each release. 16. No restore point -> tag.
17. Recall test cannot discriminate -> no-rules control. 18. Personal data -> scrub walks new folders.
19. Line endings -> LF outputs, hash test. 20. Running sessions -> kit hooks announce versions.
21. the main project briefs -> both pointer forms.

## Findings during the build

- 2026-10-28, Phase 0: the import lines in the kit's project CLAUDE.md (`@_Start Here.md` and four others)
  contain a space, and Claude Code ends an import path at the first unescaped space. `kit.mjs measure` shows
  only CLAUDE.md and AGENTS.md load: 11,267 bytes in the kit template and 14,339 in the main project, not the 115,012
  and 350,712 bytes assumed. This session's own loaded-file list matches. The standards were reaching sessions
  only when read on purpose. Phase 1's build writes imports that resolve, and a test fails on any that do not.
- 2026-10-28, Phase 2: hooks in a project-level agent file did not run in a `claude -p` check. Claude Code runs
  them only in a trusted folder, never in `-p`; user-level role files run them. The kit installs role files user
  level, so the rule now says to keep them there (rule:agent-role-table).

## Parking lot

- A kit harness any AI can query - when an AI without file access needs the kit.
- Outputs for Copilot, Cursor, Codex, Gemini CLI and .agents/skills - each when that tool is used.
- the main project on the new layout - the owner's later choice.
- Meaning-based search - at 2 lookup misses or about 500 KB of rules.
- The owner's goal for the kit (2026-10-28): the whole build automated, from start to finished product, matching the owner's expectations 9 times in 10 with the 10th caught. That includes every stop that needs the owner (size raises, push requests and the rest). The stops exist for trust: the output must match the owner's formats and styles, so drift goes down for one agent or many. Anthropic tools come first. Phases 2-3 serve this goal; measure it on a real feature run after 1.2.0.
- Size-budget increases done automatically (the owner wants to explore it) - plan after 1.1.0, against rule:size-budgets.
- The kit's PR body audits still require phrases from the project they came from ("the PII boundary", "the
  corpus and the served documents are unchanged"); make those phrase lists adapter values (A16) - next kit
  release that touches the PR body audits.
- Format skills for other tools (.agents/skills) - with the other-tool outputs above.
