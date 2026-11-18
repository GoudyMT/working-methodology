# Build 17 (1.43.0): the guard sweep's rest, the test file split and gates run from main

Scope locked by the owner's pop-up, 2026-11-18 (16 rows, tagged "build 17" in the workbench list; scope record
`results/build17-scope/REVIEW.md`). Branch `feat/guard-sweep-and-test-split` from main 1421c3f (v1.42.0). Reach is
named per item: "kit" means only the kit's own repo and builds; "every project" means every project that installs
the kit. Not in scope (build 18): the sweep floor by diff risk, `vendor/` out, one home per process skill.

## 1. Proof on the released 1.42.0 (done before this plan, $0)

Run in the owner's kit-probes folder (`b17-*`) against the release copy (tag v1.42.0) and, read-only, the installed launcher.

| Row | Result | How |
|---|---|---|
| K120 | **All 10 parts closed on 1.42.0** | The build 16 repro scripts, rerun: every fail-open shape is held (nested braces, signed range, `[[:upper:]]`, chained and wildcard climbs, a bracket set with a comma, decoy `$'`); the 4,096-glob and 64-folder caps now pass (46 ms, 75 ms); quoted braces and a quoted space are held by design (closed earlier). Install: four installs and a `--merged` run leave 0 merges and 0 backups of `CLAUDE.local.md` |
| K117 | **Reproduced, and the clock time is not the cause** | The installed launcher, asked from the workbench: `node .claude/state.mjs item set K128 note "a (b) c"` is denied; the same with no brackets passes. Any bracket in a quoted argument to a kit script is held, single-quoted too; `02:15Z` with no bracket passes. Also denied: a read loop followed by `sed -n` (as the list says), and three PowerShell reads: `foreach` with `if (Test-Path $f) { Get-Content $f }`, `$s = Get-Content ... ; $s.permissions.allow`, and `(Get-Item <guard>).Length; (Get-FileHash <guard>).Hash`. Two `state.mjs` calls joined by `&&` and plain `;`-joined `Get-Content` reads pass on 1.42.0 |
| K128 | Real in part (scope record) | The recall gate and the PR test pick run from the base; the PR body audit, the build record match, the name checks, the secret scan and the test check run from the PR's own tree |
| K124, K132 | To reproduce in the build | `kit-launch.cjs` and the six `kit-hooks` files have 261 flips today (`mutation-check --count`, main's coverage map) |
| K133 | To reproduce in the build | `owner-proof.cjs` line 165 (`CLAUDE_PROJECT_DIR \|\| process.cwd()`) |

## 2. Guards. Reach: every project

**K124 rest and K132 (high, Tier 0).** The planted-bug sweep of `user/kit-tools/kit-launch.cjs` and
`user/kit-hooks/*.cjs` (261 flips), run under WSL Linux so it sees what CI's Linux runner sees (the 1.42.0 lesson: a
plant caught only on Windows is no catch there), with the guard proofs as `--also` checks. The K126 wrapper rows run
first (section 3), so only what they leave goes to hand triage. Each real survivor gets a failing-first test,
line 733 first. The run is long (estimate 2 to 4 hours, measured on the first 10 flips and restated), so it starts
detached at low priority after the machine-load check, and resumes after a crash.

**K133.** A test that places a word from `CLAUDE_PROJECT_DIR` with the child's working folder set somewhere else, so
the `||` flip fails it on any machine, CI's runners included. Proven by planting the flip under WSL Linux.

**K117 rest.** Each reproduced shape becomes a must-pass row in `tests/guards-hold.test.mjs`, red first, then the
guard is widened only as far as the row needs:
- Bash: brackets inside quotes are text (a single-quoted argument holds no code; a double-quoted one holds code only
  through `$(` or a backquote, which stay held). A read loop followed by a `sed -n` range is read as its two reads.
- PowerShell: a variable set from a read pipeline and then read, a `foreach` whose body is `if (Test-Path)` plus a
  read, and a bracketed read cmdlet whose property is taken (`(Get-Item x).Length`, `(Get-FileHash x).Hash`) are
  reads. A bracket holding anything but a known read cmdlet stays held.
- Every widening gets its held twin in the same test (the write that looks the same), as the 1.42.0 loop rows did.

**K120 rest.** Closed with the section 1 evidence; no code. The list note names the reruns.

## 3. Tests and CI. Reach: kit, unless named

**K126 wrapper rows (owner's bar).** One generator in the guard proofs: every command of each check table also runs
inside `true && X`, `if true; then X; fi` and `echo ok; X` (PowerShell: `$null; X`, `if ($true) { X }`), and must get
the same answer. One `// why:` line per check file. Measured on the K124 sweep: survivors left for hand-check with the
rows against without them. **Bar: the count falls by at least half, or the rows are dropped.** CI seconds of the two
guard proof steps are recorded before and after; more than a few seconds goes back to the owner before merge.

**K131 test check part 0 under 3 minutes.** Part 0 spent 11 of its 11.5 minutes in A2, re-running whole test files
for every flip of the change. A2 only asks whether each untagged test catches *some* flip, so the flip run gets
the untagged tests as its only tests, and a test drops out of the run once it has caught one: the same verdict per
test, far fewer runs. A2's pool is then split over the slices by test, not by file. The gate stays as strict.
Measured on this PR's own CI (parts 0 to 3 before and after); the goal is each part under 3 minutes.

**T10 test file split, with K123 and K121.**
- `tests/kit.test.mjs` (615,896 B) splits by area into files of about 60 to 100 KB each, every test moved word for
  word. The test check learns that a test whose name and body sit unchanged in another file on the base is moved,
  not new (else every moved test would be measured as new). A test that cannot move cleanly stays.
- **K123 (every project).** The runner packs tests over its shards by each test's last run time (kept with the
  coverage map main's CI saves), so the shards finish together; tests with no time go round robin. The project
  standard says: start with one test lane; past about 2 to 3 minutes of test time, open more shards and pack by
  last run time. It goes in the testing rule and the CI template, in the house style.
- **K121 Trial A.** On the new pick: plant 20 bugs in the files the PRs change most, run `test-run --changed --pick`
  for each, and check whether a test that catches the bug was left out of the pick. Three runs of 20; 1 or more
  misses fixes the pick in this build; 0 in 40 or more closes the trial as proof. Runs in kit-probes, $0.

**K128 gates from main.** Each CI step that judges the PR (the PR body audit, the build record match, the name
checks, the secret scan, the test check) runs the base commit's copy of its script from a worktree of the base,
against the PR's tree, as the recall gate already does. A base with no such script falls back to the PR's copy and
says so. The workflow files themselves still come from the PR; the ruleset that stops that (K31) stays the owner's
step. A side effect: this PR's own test check runs main's (slower) copy.

## 4. Trials and recall. Reach: kit

**K129 builder low-effort trial.** Probe first: start one builder with the Agent tool's per-call `effort: "low"`
and read its own run record for the effort it ran at. If per-call effort works, two or three of this build's
units (the K117 rows, the K133 test, K123 packing) go to builders at low effort; a unit whose real tests fail is
re-run at high. Recorded per unit: pass or fail, re-run or not, tokens. The builder role file is not changed in this
build (kit-only trial). If per-call effort does not work, the trial stops and the row says why.

**K119 first real-use read of mid-model reviewers.** This build's one sweep runs the non-security roles on the mid
model, as 1.42.0 ships. Recorded per role: findings, real or false on check, model, tokens. The read goes in the
sweep report and the PR; no rule change.

**K134, M4 and I18: behaviour scenarios 5 and 10, and the Q3 margin.** Today scenario 5 (layout) passes a session
that does nothing, since it only checks there was no edit; scenario 10 (sweep) passes any reply holding the word
"sweep". Each gets a positive check: 5 must offer two or three layouts and ask before any edit; 10 must start the
sweep skill (or read it) before any PR command. A new scenarios version, kept beside the old. Shown on a control run
(the kit's rules taken out) that fails both, and a candidate run that passes both. Q3's margin is re-measured on
behaviour scenario 3 across the runs (I18: the strict "any edit" read). The recall comparison then runs once on
the finished text, as 1.42.0's did.

## 5. Cost and order

- **Quota (no cash).** The recall work is the only model spend: control and candidate runs of scenarios 3, 5 and 10
  (about $0.55 a scenario session, so about $5 to $10), then the full comparison the rule edits force (1.42.0's was
  about $45). Restated from measured cost before the full comparison runs. The sweep is the normal one.
- **Machine.** The planted-bug sweep (2 to 4 hours, low priority, detached, after the load check) and the K121
  replay (3 runs of 20) run on the owner's PC. CI: the normal PR runs (public repo, $0).
- **Order:** K117 and K133 rows, K132 repro, the K126 rows, then the K124 sweep in the background while K131, the
  split, K123 and K128 are built; K121 on the new pick; the scenarios and recall; release prep (1.43.0); one sweep;
  the PR.
