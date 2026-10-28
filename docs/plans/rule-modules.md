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
- [ ] Baseline run on 0.7.0 and a no-rules control run, saved. BLOCKED: the claude CLI on this PC is not signed
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
- [ ] Live checks in Claude Code (AGENTS.md loads; a path rule loads on a matching read). BLOCKED on the CLI
      sign-in, like the recall runs.
- [x] Independent review: 8 findings (2 medium, 6 low); all acted on (0307229, c8cefe1) except headroom, now
      469 bytes under the cap. The short re-check found 3 small gaps (an empty retired map, the memory path in
      the keep check, one quoted pointer); all fixed.
- [ ] Gate: 0 lost or duplicated (met), 0 broken pointers (met), 56 tests green (met), session start 44,531
      bytes (met), recall >= baseline (waits on the CLI sign-in).

Deviation: the plan doc counted 11 modules; the map it approved has 12 besides the core (project-adapter was
always its own row). Nothing moved between modules.

### Phase 2: agent access (plan D) - release 1.1.0

- [ ] Tools check: each role, foreground and background, records its real tools and what rules it sees.
- [ ] Role table in agent-teams.
- [ ] Builder and checker rules as preloaded skills (<= 8,000 bytes each; project standards win).
- [ ] Guards: builder edit-scope hook; push guard as a git pre-push hook; checker tree check.
- [ ] Role-table test; briefs cite rule IDs.
- [ ] Gate: guards proved with known-good and known-bad controls; recall >= baseline; install between the main project
      batches.

### Phase 3: formats as skills (plan C) - release 1.2.0

- [ ] Six skills (PR body, release notes, closeout, preview test, sweep, ADR) in the open SKILL.md format.
- [ ] Move only; coverage test again.
- [ ] Spec checks: names, description <= 1,024 characters, SKILL.md < 500 lines, live rule IDs.
- [ ] Live trigger check; gate: coverage, tests green, recall >= baseline.

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

## Parking lot

- A kit harness any AI can query - when an AI without file access needs the kit.
- Outputs for Copilot, Cursor, Codex, Gemini CLI and .agents/skills - each when that tool is used.
- the main project on the new layout - the owner's later choice.
- Meaning-based search - at 2 lookup misses or about 500 KB of rules.
