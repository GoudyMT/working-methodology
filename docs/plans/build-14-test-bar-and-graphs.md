# Build 14 (1.40.0): the sweep-fix test bar, the PR test run, and graphs where they pay

Locked by the owner's pop-up, 2026-11-16: scope "All 11 items" (K105 1-6, T8 7-9, K24 as item 10, N12 as item 11);
item 10 "Required if clean here"; beads "Read-only desk trial"; the per-test audit "Run now, capped". Branch
`feat/test-bar-and-graphs` from main bf637e7 (v1.39.0).

## Proven real on 1.39.0 (by quote and a recorded run)

- **The bar (items 1, 2).** `rules/reviews-and-findings.md:32`: "a fix that changes behaviour ships with a test that
  fails before it", for every severity. PR 49: 6 low or medium parser-edge findings got tests for that reason alone.
- **The claim (item 3).** `docs/builds/1.39.0.json` verification line 1: "Each change and each sweep finding has a
  test that fails on the code before it". Nothing checks it: the test check only reports, and reads no record.
- **The blind spots (item 4).** CI run 43896867336: 10 test check notes, 8 of them "its file could not load there"
  on `tests/watch.test.mjs`, a new file whose module the base lacks: that is a fail-first, not a fault. The parser
  reads only `^test('<literal>'`, so tests made in a loop (`kit.test.mjs:8472`, `merge-gate.test.mjs:383, 619`) are
  never checked.
- **The doubled run (item 5).** `.github/workflows/ci.yml`: "The security set" step runs six files after "The tests
  the change reaches" already ran whichever of them the change reached; nothing switches to the full suite when the
  selection is most of it (PR 49: 556 of 921, 235 s against 209 s for a full run on main).

## K105

1. **Fix-test bar by severity (rule text).** A high, critical, security or owner-rule fix keeps a failing-first test.
   A low or medium fix gets a new test only when a real input shows the problem; otherwise its ledger row says
   `no test: no real input`. Lines: `reviews-and-findings.md:32` and `testing.md:52` (both near the 14,000 B cap,
   so words are replaced, not added). One recall run after the text settles.
2. **The fix ledger is data in the build record.** `sweep.fixes[]` replaces the free-text `sweep.fixed` list: each row
   `{ id, severity, text, commit, test }`, where `test` is a test key (`tests/x.test.mjs::name`) or the exact string
   `no test: no real input`. `build-record.mjs check` refuses a high, critical or security row with no test key. The
   approve ledger (`reports/`, gitignored) stays the reviewers' raw list; the committed record is the one CI reads.
3. **The verdict per fix, and the claim.** `test-check.mjs --record <file>` (CI passes the record when VERSION moves)
   reads each fix's test key and states its verdict from the A1 run: `fails first`, or the A1 note. A fix naming a
   test that does not fail first is a finding. The PR body's fix line is written from the rows: "N fixes with a test
   that fails first (checked in CI), M with no test: no real input"; the record may not hand-write that claim (a
   verification line naming "each finding" or "every fix" with "test" is refused).
4. **Test check blind spots.** A new test in a file the base does not have, red because the file cannot load there,
   counts as failing first (a changed file that cannot load stays a note). Tests made in a loop are read as one unit
   per loop: changed when any line of the loop changed, run by file, and matched by the template's fixed parts.
5. **One security pass, full above half.** `test-run.mjs --changed --always <files>` adds the security files to the
   selection, so each runs once; ci.yml's separate security step goes. When the selection is over half the suite,
   `--changed` runs the whole suite and says why.
6. **Per-test audit on 1.39.0.** Coverage map plus the mutation check on a clean 1.39.0 copy under
   a probe folder outside the repo, then `test-value.mjs`. The cut list goes to the owner; nothing is deleted here
   without that yes.

## T8 (desk trial of beads first)

**Beads desk trial (its README, read 2026-11-16; nothing downloaded or run).** It keeps an issue graph with
`blocks` links and a `bd ready` list, on a Dolt database, through its own `bd` binary, and `bd init` installs its own
Claude Code hooks unless told not to. Its README says nothing of the files a task touches or of two tasks touching
one file; its "zero conflict" is about ids in merges. So it covers ordering, which a plan's `after` list already
does, and not the file fence, which is the part done by hand today. It adds a database, a binary and hooks beside
the kit's guards. Verdict: no fit for T8; the kit's own check below. Not run, so a fit it hides would be missed.

7. **Plan units as data.** A plan carries a fenced `units` JSON block: `{ id, files: [], after: [] }`.
   `project/.claude/plan-graph.mjs check <plan.md>` names unknown or cyclic `after`, and every pair of units with no
   order between them that shares a file. Replaces the hand-written pair table the lead and checker each write.
8. **Rule-to-guard map.** `scripts/rule-map.mjs` writes `docs/rule-map.json`: for each rule id in the index, the
   hooks, scripts, audits and tests that name `rule:<id>`. CI checks it is fresh, and it prints the rules no script
   names (T9's input: prose a script does not hold).
9. **Test pick by lookup.** `test-run.mjs --pick` prints the tests the change reaches by the map, without running
   them; the builder and auto-fix briefs point to it instead of a hand pick.

## Aligned rows

10. **K24.** The test check goes required (`--strict`) only if it raises zero false flags on this build's own PR.
    Otherwise it stays report-only and the evidence goes back to the owner. The ruleset change is the owner's tap.
11. **N12.** `tests/test-check.test.mjs` gains must-still-flag rows: an existing test that passes on the base, a
    changed file that cannot load, a test that fails on a crash. Item 4's narrowing cannot drop them silently.

## Decided alone

- The fix ledger lives in the committed build record, not the gitignored approve ledger, because CI can read only
  what is committed. The approve ledger is unchanged.
- Loop-made tests run by file (`<file>::*`), not by name: the harness filter takes exact names, and a template's
  names are known only at run time. Slower for a large file, correct for every loop shape.

## Known limits

The `no test: no real input` call is the lead's; the record shows it to the reviewer of the PR and to the owner, and
no script can tell whether a real input exists. The rule map counts a name, not whether the script truly holds the
rule.
