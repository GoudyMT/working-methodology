# Build 15 (1.41.0): the rules diet (T9), with the 1.40.0 findings

Locked by the owner's pop-up, 2026-11-17: scope "Wide: items 1-6"; E2 "Remove it completely - I won't be typing code
anymore. Its the AIs job to build smart modular code"; the test-check slice budget stays at 12 minutes, and ways to
make CI faster without giving up security or usefulness are explored (item 7, options before any build). Branch
`feat/rules-diet` from main 46f0976 (v1.40.0).

## 1. Proof on 1.40.0

- **Recall before the cut.** The released rule text equals the scored build 14 candidate (`git diff db6485d main --
  rules project/CLAUDE.md docs/evals` is empty): median 14 of 14 over five runs, keys v12 (`recall-scores.md`, last
  entry). That is this build's before-cut baseline; no new baseline run.
- **Caps.** `rules/reviews-and-findings.md` 14,000 B (the cap), `git-and-release.md` 13,995, `agent-teams.md` 13,993,
  `tracking-and-handoff.md` 13,978, `testing.md` 13,928: any new rule line there needs a trim first.
- **Prose a script already enforces** (section bytes on 1.40.0): Standing Grants 2,102, PR Body Standard 2,263,
  Release Notes 2,114, Agent Role Table 1,980, Agent Canary 1,786, Git: Local Work vs Outward Acts 2,994, First Push
  Gate 1,713, Size Budgets 2,814, Kit Stays Local 1,177, Tracking File Size Caps 1,110, Sweep Auto-Approval 1,087,
  Commit Message Format 1,030.
- **Rows already gone:** A1 (no "reopens as high" line in rules/) and A3 (one cap, 14,000, for every module in
  `kit.config.json`): closed as fixed in the released code.

## 2. Cut prose a script enforces

Each section keeps what a session must do and the command that does it; the narration of what the script checks
goes (the script names what failed when it runs). Kept word for word: every line a recall key (v12) reads (Q3 the
resume packet, Q4 the push bound, Q7 the swarm contract and approve.mjs, Q8 trim before asking, Q10 the sweep, Q11
temp files, Q12 the carry wording, Q13 closeout, Q14 the pop-up yes) and every owner-pinned line (`// pin: 4` in
tests). Each reworded line goes in `docs/migrations/1.41.0-reworded.json`.

Acceptance: every touched module ends at least 10% under its cap; `kit.mjs build` output committed; the rule map and
INDEX still resolve every `rule:<id>`; recall median on the candidate is not under 14 (keys v12), five runs.

## 3. One home per rule

- **J-R3.** `project/CLAUDE.md` repeats AGENTS.md's hard rules; each copy becomes a one-line pointer to its home.
- **E4.** Measure each always-loaded piece (AGENTS.md, CLAUDE.md, memory index, skill listings) on a fresh install;
  the numbers go in the PR. Turning off plugins is the owner's machine setting, not kit text: named, not built.

## 4. Contradictions

- **E2 (owner's ruling).** The kit's `user/CLAUDE.md` loses every line resting on "the owner types all code": the
  two Collaboration Workflow bullets ("One cell/step at a time ... user types it manually", "User types all code
  manually ... never runs code for the user"), "Claude CAN write .md and .txt files with permission", and the Cell
  Justification Checklist section (written for code cells the owner types). What stays: one step verified at a time
  against real output. The exact removed lines go in the PR body for the owner to see.
- **A2.** Recheck: the one-sweep rule and the fix tier's fix check are different things on 1.40.0; closed if no line
  says a feature PR runs a fix check after its re-sweep.
- **Teardown C1 to C8**, rechecked on 1.40.0: each still-true clash gets one home and one answer; one already gone is
  named closed.

## 5. Small rows

A6 (the autopilot plan's SUPERSEDED line; history comments), A8 (sibling text named with the rulings), M23 (the
stale comment at `user/kit-hooks/call-cap.cjs:9`: the v1.17.0 live run shows role-file hooks firing), S17-H1, S22-5,
J10 (three one-line lessons), N13 (dense screens: a front-stage / on-demand split line in design-and-ux), E8 (the
rest of the in-rules logical-yes stops: listed with file:line, each changed or kept with its reason). A row that does
not reproduce on 1.40.0 is closed, not built.

## 6. The 1.40.0 findings (code, test-first)

- **N12.** `scripts/test-check.mjs:204` ("fails on the base commit, but not on an assertion (a crash or a missing
  file)") has no test. A must-still-flag row in `tests/test-check.test.mjs`: a changed test that throws on the base.
- **K107.** `scripts/recall.mjs` `removeProbe` deletes the probe folder and its memory, never its guard record in
  `<home>/kit-guard`, so every recall run leaves one (build 14: 13). Fix: removeProbe forgets the record after the
  folder goes. Test: a probe with a record; after removeProbe the record is gone. Real input: build 14's 13 records.
- **K108.** `scripts/test-run.mjs:262` reads only `tests/*.test.mjs`; CI's slow lane reads only `tests/slow`. A test
  file in any other tests/ subfolder runs in no lane. Fix: the runner names such a file and exits non-zero. Kit only:
  project templates call the project's own runner. Test: a folder with `tests/x/a.test.mjs`. Latent today.
- **K109.** `docs/builds/1.40.0.json` WHY-LINE has no `reach`, so it defaulted to projects. Fix: from 1.41.0 every
  record item states `reach` (projects or kit); `build-record.mjs check` refuses a missing one; 1.40.0's row gets
  `reach: kit`.

## 7. Faster CI, explored

Measure where PR CI time goes on PR 50 (per job and step), then list options that keep every check and every
security test (cache, sharding, the change-scoped lane, the runner), each with its saving and its cost. To the owner
by pop-up; nothing built without his pick.

## Plan check

One fresh read-only agent, the fixed brief, 2026-11-17: 10 findings (4 high). How each was taken:

- **P1 high, owner text reworded without a pin:** the owner's call. Every changed rule line went to the owner in one file (before and after); his pop-up, 2026-11-17: "Yes, all of them".
- **P2 high, E2 consumers:** acceptance. Edit Discipline ("the cell justification checklist", "type it yourself"), CLAUDE.md rule 8 and the global scope line changed; a grep for the four phrases over rules/, project/ and user/ is empty.
- **P3 high, J-R3 drops unique text:** limit. Only hard rules 1, 2 and 8, whose every clause is in AGENTS.md, became pointers; 9 to 14 stay in full (rule 11 holds the Q3 key clause, rule 14 is pinned).
- **P4 high, a cut sentence no script checks:** acceptance. Each cut is in docs/migrations/1.41.0-reworded.json; the duties the agent named ("Claude never writes them", "never delete it in the next commit", "made private first") are kept.
- P5 medium: the ledger records every changed line, not only v1.1.0 lines. P6 medium: limit below. P7 medium: measured, see Result. P8 medium: the K108 check runs on full, --changed and --map runs (no file list); only tests/slow itself is exempt (test). P9 medium: a failed forget is named on stderr, never thrown; forget reaches removeProbe through kitTools. P10 low: any *.test.* file a lane skips is named (test).

**Limits:** recall measures the project layer only; E2 (user/CLAUDE.md) and the M23 comment are unmeasured, and the owner read them line by line. Other AI tools read only AGENTS.md, so nothing moved into CLAUDE.md alone. Cap figures do not prove nothing was lost: the ledger does.

**Owner calls, 2026-11-17 pop-up:** rule lines "Yes, all of them"; precedence "Project, for its own rules" (rule:instruction-priority rewritten, one order); faster CI "Yes, this build".

Would self-approve: no (owner text changes: E2).
