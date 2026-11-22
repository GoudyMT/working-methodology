# Build 24 design: kit 1.51.0

Status: DESIGN, waiting for the owner's yes. Nothing is built before it.

## Overview

What we are looking at: three studies done on the kit itself (agent handoff cost, strict test-first round 2, model
and effort per step) and the guard bug they hit. Every number from them is SUSPECT until a clean throwaway
reproduces it; this build reproduces what it acts on before it builds.
What is being decided: the design of 15 rows, the tester-model criteria list (K307), and six calls listed in
section 4.
Shape: one branch from main at f7fa3f7, one PR (15 rows), test-first, one sweep (paired with the cloud bench), every
finding fixed in the build, recall and behaviour gate at the fixed floor. Lead stays Opus 5.5 medium; no context-cap
line ships.

## 1. Proof first

Run 2026-11-22 on the released v1.50.0 hook, fed the hook input directly, in a probe repo outside the kit.

| Row | Result | Evidence |
|---|---|---|
| K339 folder read as a file | REAL on the PC | Feature branch, new test `tests/b.test.mjs`: `node --test tests/b.test.mjs` allowed; `node --test tests/` and `node --test tests` refused ("reaches tests, which this branch did not change"). Cause: `path.relative` drops the trailing slash, so `tests/` is compared as a file named `tests`. Only `go test` marks folders today. |
| K339 second trigger | REAL on the PC | Same repo with no remote, on main after a merge: every run refused, even the named new file. Cause: with no remote, the base is `main` itself, the merge base is HEAD, and the change set is empty. |
| K340 guard not firing on PC trials | EXPLAINED, not a guard gap in the hook | The trial home's user layer is v1.33.1 (installed 2026-11-15) and has no `kit-hooks/test-scope.cjs`; the guard came in 1.46.0. `guard.cjs` skips a missing user-layer hook by design. New finding (SUSPECT until a row is placed): nothing tells a session that its user layer is older than its project layer. Proposed as a new list row, not in this build. |
| K315 open template slots | REAL by quote | A fresh install's `AGENTS.md` keeps `<PROJECT NAME>` and `<fill in>`; `kit.mjs` has no code that fills them. That Haiku stops on them is the trial's claim (SUSPECT); the fix below does not depend on it. |
| K277, K300, K301, K307 to K312 | Design rows: nothing to reproduce before building | Each builds a new check; its failing test is its proof. |
| E36 role table | PARTLY LIVE | 1.50.0 has `kit.config.json` roles (5 roles, model and effort) and writes role files from it; session start prints a Kit roles line. Missing: the full step table, never-drop rows, the Agent hook, the CI check, the list row, the new roles. |

## 2. The rows, one design each

Reach: "kit" means the kit's own repo; "projects" means it installs into every project.

### A. Handoff record (K300, K301, K294)

- **K300 record.** One JSONL schema in a new `user/kit-tools/handoff.mjs` (shared by kit and projects). Finding line
  keys, all required: `id, severity, status, where, claim, proof, fix`; plus `{"notChecked": ...}` and
  `{"note": ..., "writer": ...}` lines. The working agent writes it after its prose reasoning, in the hand-back,
  below a fixed `RECORD:` line. One line per finding; only the lead merges; role and commit come from the brief.
  Writers changed: approve.mjs sweep brief shape, the builder and checker brief templates, the three rules skills,
  K277 lane briefs. Not changed: PR bodies, release notes, owner reports, chat, scanner counts, lookups.
- **approve.mjs parser.** The pipe parser (splits a claim with a `|` into wrong fields) is replaced by the JSONL
  reader; a pipe inside a claim stays inside the claim. One release reads both shapes so an old hand-back still
  tallies, then the pipe shape is cut in build 25.
- **K301 gate.** `handoff.mjs check <file|->`: exit 0 valid and non-empty, 1 with the exact error list, 2
  unreadable. Empty never passes. One retry with the errors, then the raw hand-back goes to the lead marked
  unchecked. Raw hand-back always kept. Claude agents: the check runs at `SubagentHandback` in builder, checker and
  reviewer role files, beside canary.cjs. approve.mjs refuses to tally a failing record. Other agents: install writes
  the same script as a git hook step. The hook starts log-only (K225, below); approve.mjs refusing to tally is a
  script check and enforces from day one.
- **K294.** A short "What holds where" section in `AGENTS.md` and one line in `rules/security.md`: the guards that
  only Claude Code runs, and that git hooks and CI are the only layers that hold other agents. A kit test checks the
  line exists in both.

### B. Test method T1 to T9 (K307 to K312, K315, K339)

- **K339 fix (lands first, it blocks the rest).** A folder argument (`tests/`, `tests`, `./tests`) resolves to the
  test files under it; the run passes when every test file under it is in the change set, for every runner the
  guard reads, not only `go test`. No distinct base (no remote, or HEAD is the base): the guard lets the run through
  and logs the cause, as it does for every other case it cannot read (it is a cost guard). Tests: each runner with a
  folder, a folder holding one unchanged test (still refused), no-remote main.
- **K307 tester role.** New `user/agents/tester.md`: Haiku 5.5 medium by default, writes only test paths (its own
  fence list, written by the lead), commits the red commit only. A new `user/kit-tools/tester-model.mjs` reads the
  unit's spec record and prints `haiku` or `sonnet` plus the criterion that fired. The criteria list is section 3;
  it is built exactly as approved. The batch plan template gains two unit columns it reads, `Risk` and `Tester`.
  Low-risk units marked "Built by: lead" keep one agent and still pass the
  commit-shape check. The tester brief says: scratch files go in the session scratch folder, never inside `.git`.
- **K310 test review.** New read-only `user/agents/test-reviewer.md` (Read, Grep, Glob only; Haiku 5.5 low). It
  reviews the red commit before any builder starts and writes JSONL lines (K300 schema, statuses `wrong-test`,
  `uncovered`, `passes-on-base`, `vague`) plus one "reveals intent" question. Any line stops the build and goes
  back to the tester. The lead's builder start is refused by the handoff gate unless a passed review record for
  that unit exists (`handoff.mjs check --review <unit>`).
- **K308 test lock.** After the red commit lands, the lead (never the builder) writes `kit-unit-files.txt` with
  source files only; the existing edit fence then blocks test edits. A wrong test is a stop-and-report. The builder
  brief stops telling the builder to write its own list. T3 (test change after red): see call 3.
- **K309 and K312 commit shape.** New `user/kit-tools/unit-check.mjs base..head`, reusing test-check's A1 run: a
  unit is a test-only red commit, then commits touching no test file; the red commit's new tests fail on its own
  tree on an assertion (by test name) and pass on the next source commit; a `refactor:` commit leaves every test
  file byte-identical and the same tests green before and after. A duplication count is a report line only. The
  lead runs it before each cherry-pick; kit CI runs it on the PR range for units marked in the build record.
- **T6 brief line.** The builder brief says "the tests are a floor; build what the spec says, as simply as it
  allows", never "only what the tests demand". The checker keeps its break check.
- **K311 minimal-code gate.** `mutation-check.mjs --base` already flips only changed lines. New: a report-only CI
  job on the PR range that flips the added production lines and lists survivors as "missing test or code the tests
  do not demand". It never fails the run in 1.51.0 (K225). It prints its flip count first; cost is call 5.
- **K315 slots.** Install prints each unfilled slot it left (`<PROJECT NAME>`, `<fill in>`) with the file. The brief
  writer reads the rules block by its found lines (never a fixed offset) and refuses a block that still holds one
  of the named slots, saying which. Only the named slot list is refused: format examples like `<feature branch>`
  are not slots.
- **T9 limits.** Already live (per-session budget, call-cap hook, run cap); the tester and test-reviewer role files
  get the call-cap hook like the others.

### C. Model table (E36 widened, K303 folded, K341)

- **One table.** `kit.config.json` `roles` grows to every step below, each with `model`, `effort`, `enforcer` and
  `neverDrop`. Install writes every role file's model and effort lines from it (as today, for more roles).

| Step | Model | Effort | Enforcer | Never drop |
|---|---|---|---|---|
| Lead (main session) | Opus 5.5 | medium | install user writes settings.json | yes |
| Orchestrator | Opus 5.5 | high | orchestrator.md (unmeasured: stays until a recorded phase run passes) | |
| Tester | Haiku 5.5 (Sonnet by tester-model.mjs) | medium | tester.md, tester-model.mjs | |
| Test review | Haiku 5.5 | low | test-reviewer.md | |
| Builder | Sonnet 5.5 | low; high on a red rerun | builder.md; the brief names the rerun effort | |
| Checker | Opus 5.5 | high | checker.md | yes |
| Sweep breadth | Sonnet 5.5 | high | approve.mjs DEFAULT_MODEL | yes (no lower than Sonnet) |
| Sweep security and novel lens | Opus 5.5 | high | approve.mjs TOP_DEFAULT | yes |
| Recall and behaviour gate | Opus 5.5 | fixed | recall.mjs, recall-behave.mjs | yes |
| Blind scorers (two, averaged) | Opus 5.5 | medium | recall-score.mjs; never Fable | yes |
| Scanner | Haiku 5.5 | low (from medium) | scanner.md | |
| Researcher and read-only lookups (K303) | Haiku 5.5 | medium | new researcher.md; project Explore.md pinned to Haiku | |
| Fix brief drafter | Haiku 5.5 | high | new drafter.md (read-only); the lead reviews | |
| PR body writer | Haiku 5.5 up to 10 files; Opus 5.5 medium above | medium | new writer.md; new pr-size.mjs reads `git diff --stat` | |
| Closeout and handoff | Opus 5.5 (the lead) | medium | the lead | yes |
| Step 6 verify, release check | script, no model | - | release-check.mjs | yes |

- **Agent hook.** A PreToolUse hook on the Agent tool (in the one guard process) holds a subagent call with no
  pinned model or a model that differs from the table for that role (closes MC2: Explore and general-purpose inherit
  the lead's Opus). Starts log-only (K225).
- **CI check.** A kit test fails when any role file, approve.mjs default, recall model or Explore.md disagrees with
  the table, or a never-drop row is lower than its floor.
- **Session-start list row.** When a role runs on a model the table does not name, or one marked retiring, session
  start adds one list row through state.mjs (once per model and role, never twice) and keeps the Kit roles line.
- **K341 projects.** Install gives a project the same role files. An optional `.kit/models.json` may change a row's
  model; `kit.mjs install` and a project CI step refuse an override that lowers a never-drop row, naming it. The
  writer size rule runs on the project's PRs through pr-size.mjs. Large-project format is untested: one real-use
  check on one of the owner's projects at step 6.
- **Real-use check (in this build).** For the researcher, drafter and writer rows: the table model beside the current
  one on the same real task from this build. Pass: no fact lost, quotes correct, word check and PR-body audit pass.
  A miss keeps the old model and adds a list row.

### D. Lanes and log-only (K277, K225)

- **K277.** After triage, a new `lanes.mjs` (beside plan-graph.mjs, same shared-file logic) groups findings into
  lanes with no file in common, from each finding's `where` keys plus a Haiku scanner's list of files each fix
  touches. One Sonnet builder per lane, test-first in its own worktree; an Opus checker reviews every lane before the
  lead merges. Lane count comes from file overlap, never a fixed number. pre-pr-sweep step 5 and agent-team-build
  batch mode name it. This build's own sweep fixes run in lanes.
- **K225.** A hold list in data: each guard hold has `mode: log | enforce`. A new hold ships `log` (it writes what it
  would have held to the guard log and lets the call through). A kit test fails when a hold that shipped `enforce`
  in the last release is `log` now: existing holds never drop. The holds made in this build (Agent model hook,
  handoff hook, K311 job) ship `log`; switching to `enforce` is call 4.

## 3. K307 tester-model criteria (for approval)

The script reads only fixed fields of the unit's row in the batch plan and the unit's test-review record. It prints
one line: `tester: <model> (<criterion id>: <reason>)`. First criterion that fires wins, in this order. No criterion
fires: `tester: haiku (default: no criterion fired)`. A missing or unreadable plan row is an error (exit 2), never a
silent Haiku.

| Id | Criterion (fires: Sonnet) | Field read | Fires when | Test: fires | Test: does not fire |
|---|---|---|---|---|---|
| R1 | Marked high risk | unit row `Risk` | value is `high` | `Risk: high` -> sonnet R1 | `Risk: low`, `Risk: medium` -> haiku |
| R2 | Guard, hook or gate code | unit row `Files` | any path matches the guard list (`kit-hooks/`, `.githooks/`, `guard*.cjs`, `settings.json`, `approve.mjs`, `merge-gate.mjs`, a project adapter's protected paths) | `Files: user/kit-hooks/test-scope.cjs` -> sonnet R2 | `Files: scripts/lanes.mjs` -> haiku; a path that only contains the word (`docs/guard-notes.md`) -> haiku |
| R3 | Foundation logic | the plan's `Runs` column of other units | two or more other units run `after` this unit | U1 with U2 and U3 `after U1` -> sonnet R3 | U1 with one unit after it -> haiku |
| R4 | Vague spec, seen by the review | the unit's test-review record | a `vague` or `uncovered` line from a Haiku tester's attempt | review record with one `vague` line -> sonnet R4 on the rerun | review record with only `wrong-test` lines -> haiku rerun (a wrong test is fixed, not escalated) |
| R5 | No checkable example | unit row `Tests to write first` | empty, or no line names an input and an expected output (`->`) | empty cell -> sonnet R5 | `parse("1.2") -> RangeError` -> haiku |
| R6 | Owner raised it | unit row `Tester` | `sonnet` or higher, written by the owner at plan approval | `Tester: sonnet` -> sonnet R6 | `Tester:` empty -> haiku; `Tester: haiku` on a row where R1 fires -> sonnet R1 (a row can raise, never lower) |

Each row has its two tests written by the tester role before the script exists; the order rule and the exit 2 case
get one test each. Ten-plus test cases in all. R2's guard list is one data list shared with K341's never-drop paths.

## 4. Calls for the owner

1. **Approve the K307 criteria list above** (R1 to R6, order, default Haiku, missing row is an error).
2. **K339 no-base case.** Recommended: let the run through and log it (the guard's own policy for anything it cannot
   read). Other: refuse, as today.
3. **T3 test change after red.** Kit commits are one line with no body, so a `Test-change:` trailer cannot ride.
   Recommended: a new subject type `retest:` for a commit that changes a test after red; unit-check passes it only
   when it is that type, and the outward guard holds the push that carries it for your pop-up yes.
4. **When log-only holds switch to enforce.** Recommended: after one full build (25) with the guard log read and zero
   false holds, on your pop-up yes in that build. Other: a fixed count of real uses.
5. **K311 CI cost.** Report-only, added lines only. Recommended: a cap of 4 slices of 12 minutes per run, cost stated
   after the first measured run, and a skip when the flip count is zero.
6. **Rule text room.** `rules/agent-teams.md` is at 13,998 of 14,000 bytes. Recommended: the new lines live in the
   role files, brief templates and scripts that enforce them; the module gets pointers only, paid for by trimming
   its own words. Reworded lines get a record and the recall gate covers them.

New finding for a list row (not this build): session start says nothing when the user layer is older than the
project layer, so a stale home runs with guards missing (K340 above).

## 5. How this build runs (on its own table)

Design: the lead. Tests: tester role on Haiku medium (Sonnet only by section 3 once built; until then the lead runs
the criteria by hand and names the criterion in the run record). Test review: Haiku low before any builder. Build:
Sonnet low, high on a red rerun, tests locked. Check: Opus high. Sweep: Sonnet high breadth, Opus high security and
novel lens, fixes in K277 lanes, paired with the cloud bench (head, contract and briefs sent blind before the PC
findings exist). Gate and scorers: Opus, fixed. PR body: writer step with the size rule. Until a role file exists
for a step, its agent is started by hand on the table's model and effort, and the run record names the model.

## 6. Units (draft order)

U1 K339 guard fix. U2 K300/K301 handoff.mjs and approve.mjs parser. U3 K309/K312 unit-check.mjs. U4 K308 lock and
T3. U5 K307 tester role and tester-model.mjs. U6 K310 test review. U7 E36 table, roles, Agent hook, CI check, list
row, pr-size.mjs. U8 K341 project override. U9 K225 hold modes. U10 K277 lanes.mjs. U11 K311 CI job. U12 K315
slots. U13 K294 docs line. U14 VERSION, build record, reworded record. U1 runs first; U2 before U6 and U10; U9
before U2's hook and U7's hook.
