# Build 3 (1.29.0): the 1.28.0 carry-overs and the sweep's guard fixes

**Outcome, 2026-11-13 (read this first).** Sections 1 to 9 are the plan as the owner locked it and are kept as
written. What was built is section 10. Two things differ from the plan: the rule text (K42, K43, C17, K37 and the
two test-rule lines) was written, measured three times and pulled, so 1.29.0 changes no rule text; and K34 was
redone twice, ending as a list the tools never write and that install records outside the project.

Status: LOCKED by the owner's pop-ups, 2026-11-13: this scope, with the resume packet (T3) in build 4; K30 option B's probe, else A; K33 closed as a named limit; one local recall measurement. Branch `feature/carry-overs-and-cost-rule` from
main 7d7fdd0 (v1.28.0), local only.
Source of truth for the rows: workbench `_Kit Improvement List.md` (42 rows tagged build 3; F28 is K30 to K43).
Plan: project file `kit-teardown/PLAN.md` section 7. K40 (CI on the owner's PC) is cancelled by the owner and is
re-tagged at closeout, not built. This is plan-check trial 2 of 3 (K20).

## 1. Sixty-second overview

- **What:** close the 42 carried rows. Sorted against the released 1.28.0 they fall into four groups: 10 are already
  fixed or have no reach (close, no build); 19 are code and test work; 4 are rule text that one recall measurement
  gates; 9 belong to a later step (T3, T10) by the plan's own table and are re-tagged there.
- **The three owner asks in it:** the cost rule (K42), the pop-up yes as the kit standard (K43), and the mutation
  measure scoped to what a change touches (K41).
- **Not in it:** T3 to T11. Each needs the owner's lock on a shape and starts with a trial (plan section 7). None
  fits beside 23 rows under one sweep. T3 (the resume packet) is the proposed build 4.
- **Reach:** K14, K38, K41, K17, K36, the R6 rows and the closes reach ONLY THE KIT (its own tests and CI). K32, K34,
  K35, K30, C13 and I6 change guard files, and K42, K43, C17 and K37 change rule text: those reach EVERY PROJECT
  that installs 1.29.0. (As built: K35 changed nothing, K30 is a comment in the guard's header, and the rule text
  did not ship.)
- **Money:** hosted CI on the public kit repo is free. No full mutation measure is planned (the old one cost about
  600 minutes; K41 makes the scoped one the default). The paid or metered parts are one recall measurement (section
  5), the plan check (about 180,000 tokens last time) and the one sweep (5.6M tokens last time). Each is the owner's
  yes before it starts.

## 2. Sorted on the released kit (1.28.0, release copy at v1.28.0), 2026-11-13

Probe: tool calls through the release copy's `project/.claude/guard.cjs` in process, cwd a throwaway git repo
`<home>\kit-probes\b3-repro` (`probe.cjs`, `cases1.json` in this thread's scratchpad).

### 2a. Reproduced or real by quote: build

| Row | Proof on 1.28.0 | Right answer |
|---|---|---|
| K32 | PowerShell `node --test tests/*` answers "Never by a tool: the kit's guards..."; the same line in Bash runs | Runs in both (a false hold; fails closed) |
| K30 | Bash `node -e` that builds both the marker name and the push at run time: runs, no hold. With the push spelled plainly it is held (owner's yes); with the marker spelled plainly it is Never | See section 4, K30: no text guard can read a name built at run time |
| K34 | `owner-proof.cjs:446`: a missing `protected-folders.json` returns an empty list; `rm .claude/protected-folders.json` answers "Owner's yes needed", so one tap drops every listed folder | A list that existed and is gone holds writes until the owner restores or removes it on purpose |
| K14 | `tests/guard-dispatch.test.mjs:141` and `tests/guards-outside.test.mjs:1259` time the wall clock; 10,572 ms on a slow runner, 1.9 s on the owner's PC | The guard's own work against the same 8 s |
| K41 | `.github/workflows/test-value.yml` runs `mutation-check.mjs --slice i/8` with no files and no base: every flip in the kit | The flips of the files a change touches |
| K42 | No rule names CI minutes or cost (grep of `rules/`: none) | A rule (section 5) |
| K43 | `rules/evidence-and-failures.md:51`: "ask in the thread for one typed sentence" | A pop-up yes quoting the act (section 5) |
| K38 | 25 flips alive at 7d7fdd0, argued equal, not run | Each built and run, or proven equal by a run |
| I19 | `scripts/recall.mjs:46`: the graded list omits `scripts/kit.mjs`, `project/` beyond `project/CLAUDE.md`, `memory/` | The owner's cost call (section 6) |
| I17 | `scripts/recall.mjs:312`: read tools with no path limit | Later step (T10) |

### 2b. Already fixed in the released code: close, no build

Each is quoted from `scripts/recall.mjs` at v1.28.0. Step 1 confirms a test covers each before the row is closed.
Confirmed 2026-11-13 in `tests/kit.test.mjs`: the tests named "recall gate (S18-2)", "(S18-3)", "(S18-5)",
"(S18-6)", "(S18-7)", "recall (I27)", and the `checkSessionHome` test for S18-1; J2 rests on the gate's own lines.

| Row | Where it is fixed |
|---|---|
| I27 | `removeProbe` lines 191 to 194: the probe shape, inside this home's kit-probes, links followed, a plain slug |
| S18-1 | `checkSessionHome` lines 136 to 143: refuses when sessions read another folder than the layer checked |
| S18-2 | Lines 372 to 374: paths compared after links |
| S18-3 | Line 272: the ruler is the head commit's |
| S18-5 | Line 258: no output cap |
| S18-6 | Lines 234 to 237: an owner-accepted correction on an older ruler |
| S18-7 | Lines 47 to 50, 241, 242: the control line, required from keys v4 |
| J2 | The bar is the keys file's "Pass: median n of m" line, committed; the gate refuses a PR that moves its own ruler (line 244) and a median under the bar (line 243) |
| V5 | No reach, third read: `description` holds a main force push, `command` a feature push; the guard reads `command`, and the shell runs only `command`. Closing as not real |
| K40 | Cancelled by the owner 2026-11-13 |

### 2c. To reproduce in step 1, before any fix

C13 (needs a project path long enough for Claude Code to shorten its slug; the longest slug on this PC is 173
characters and is not shortened), K33, K35, K36, I6's four leftovers (fetch against push repo, BOM ledger, owner
allow-list, `--amend-outcome`), R6.2, R6.4, R6.5, R6.6, S18-4, J8. A row that does not reproduce is closed with its
probe, not built.

### 2d. Not recoverable as written

K39: the 1.28.0 report says "one low carried" (privacy) and "one medium carried" (supply chain) and names neither.
The supply-chain one is most likely the line "a PR editing ci.yml undoes its own scope rule unless a ruleset stops
it", which is the owner's GitHub setting. The privacy low is not written down anywhere in the kit source. Proposed:
close K39 as unnamed; this build's sweep runs the same two roles and re-finds what is real.

## 3. Step order

1. Reproduce the 2c rows; confirm the 2b tests; get the 25 survivors' lines (the artifacts of run 43411863709, or a
   scoped local run on the four files after a load check).
2. Kit-only work: K14, K41, K36, R6 rows, K38, J8.
3. Guard work: K32, K34, K35, C13, I6, then K30 if the owner picks an option that builds.
4. Rule text, settled in one pass: K42, K43, C17, K37. Then one recall measurement.
5. K17 measured on this build's own PR. M27 measured at this build's sweep. No code for either.
6. VERSION 1.29.0, CHANGELOG, build record; one sweep; PR.

## 4. Designs

**K14, timing by the guard's own work.** The child reports `process.cpuUsage()` (user plus system) on exit through an
env-named file; the test asserts CPU time under 8,000 ms, the same number. A wall-clock miss alone no longer fails. A
second assertion keeps a loose wall bound of 60 s so a hung guard still fails. For the R4.2 test, whose point is that
slow hooks are cut short, wall time is the thing measured: it keeps the wall clock and is not changed.
Acceptance: with the guard made quadratic again (the pre-T2 read), the CPU assertion fails; with a 3 s sleep added to
the test's parent, it passes.

**K41, the scoped measure.** `test-value.yml` gains a `base` input (default `origin/main`) and passes `--base` to
`mutation-check.mjs`, which already has it. A push to `test/measure-*` uses the default. The whole-kit run stays
possible only by a typed input `scope: all`, and the job's first step prints the flip count and an estimate of
minutes before any slice starts. Acceptance: a branch that changes one guard line runs only that line's flips; a
test for the count-first step.

**K36.** The test check reads the rule index from the PR's own copy when the PR changes it, else the base's.

**K38.** For each of the 25: a test that fails with the flip in place, or a run that shows the flipped line cannot
change any output (the case is written, run on both versions, and the equal outputs recorded in the build notes).
"Argued equal" is no longer an answer. Closes S23-1 and the rest of M28 with it.

**K32.** The PowerShell wildcard rule reads `tests/*` as the Bash rule does: a `*` under a named folder that is not
`.claude` and does not begin the last part with a dot is not a dot-name wildcard. `tests/.claude` existing on disk
still holds. Acceptance: the four probe lines of section 2a, plus `Remove-Item .claude/*` still Never.

**K34 (changed by the plan check, P1, P7, P9, P16).** The first design recorded the list's hash outside the project;
the plan check showed its fix path was the same one tap (`rm` then the launcher's own `install project` line) and
that it false-held worktrees and branch switches. Replaced by the simpler rule: `.claude/protected-folders.json`
moves from the settings shape (owner's yes) to the guard shape (Never by a tool). The owner writes the list in their
own editor, as the 1.28.0 note already says ("the list is the owner's to write"). No record, no new state, no upgrade
window. Tests: `rm`, `mv`, an Edit and a Write of the list are each Never, with and without a yes on record; a read
runs. Reach: every project; a tool can no longer edit the list even with a yes.

**K30, the owner's pick (three options).** The hole: a program started by the AI shell can clear its own markers
before it calls git, so the pre-push hook takes it for the owner's terminal.
- A. **Name it as a limit** in `rules/security.md` and the guard's header; fix it in T12 (the OS sandbox probe).
  Cost: nothing now. The hole stays open until T12. Reach: none.
- B. **The hook also asks who its parents are.** The pre-push hook walks its parent processes and holds when one is
  Claude Code. Step 1 probes it first on Windows: time per push, and whether a detached child breaks the chain. Built
  only if the probe shows it holds; a lookup that fails counts as the owner's shell only if the markers are also
  absent (so it never blocks the owner's own terminal), which means a detached child still gets through. Reach: every
  project. Adds about 0.3 s per push (to measure).
- C. **Hold `node -e`, `python -c` and their kin whenever the text names `child_process`, `spawn`, `exec` or
  `subprocess`.** Closes the short form; a script file written first and run second still passes. Many false holds
  on ordinary one-liners. Reach: every project.
- Recommendation: B's probe in step 1, then B if it holds, else A. C trades many stops for a partial close.

**K33.** A shell option set in the owner's own profile is outside what a hook can read. Proposed: name it as a limit
beside K30's and close. If the owner wants it held: every bare `*` write or delete at the project root is treated as
reaching dot names, which makes `rm -rf *` there a Never.

**C13, K35, I6, R6 rows, J8, S18-4.** Designed after their step 1 probes; each is one small change with a failing
test first, or a close.

## 5. Rule text and the recall measurement

All four texts are written and settled before the first run (the 1.18.0 lesson: an edit after a run is another run).

- **K43** `evidence-and-failures.md:51` becomes: on a permission block, ask with a pop-up that quotes the exact act;
  typed words only where the tool or model has no pop-up.
- **K42** a new line in `rules/git-and-release.md` (CI is its home): before a heavy run or a direction that adds CI
  or metered spend, state the minutes, the dollars and what is already used; a paid option is never the default.
- **C17** one definition of "held" and the four kinds named, in the words 1.26.0 locked. The 1.27.0 attempt scored
  11 against a bar of 12 with the baseline also at 11, so that run could not have passed whatever the text said.
- **K37** the title rule's words in the rule modules and the A2 row, as the pr-body skill already has them.

**The measurement:** 3 candidate runs, 3 baseline runs (the release copy at v1.28.0) and 1 control, 13 questions
each, then a blind scorer. About 91 headless sessions. Checked 2026-11-13: a local measurement runs on the
owner's own sign-in, so it is $0 on a card and is paid in subscription use (the list's "about $25" is the
API-priced figure, for the CI recall job, which stays off).

**The risk, said up front:** the baseline has scored 11 and 12 on a bar of 12. If the candidate lands at 11, the
gate refuses it and the four rule rows are reverted and carried, as C17 was. One measurement is the plan; a second
is the owner's call, with its cost.

## 6. Owner's calls in this plan

1. Scope: the 23 rows of sections 2a and 2c plus the closes, with T3 to T11 starting in build 4. Or a smaller cut.
2. K30: A, B or C.
3. K33: close as a named limit, or hold bare `*`.
4. K39: close as unnamed.
5. I19: widen the graded list (more PRs then need a paid recall run) or leave it. Recommendation: leave it until
   recall moves to behaviour in T10.
6. The recall measurement: yes or no, asked again with the verified cost right before it starts.

## 7. Re-tagged to their plan step, not built here

M4 (Q3 with T3, Q10 with T10), I17, I18, S22-A5 (T10, "recall moves to behaviour"), E14 (the notes come from the
build record, T13's second half with T4), M27 (measured at this sweep; the row stays open until the count is in).

## 8. Cannot reach

- A command a program builds at run time (K30) under options A and C.
- A cloud session: no hook runs there.
- The recall rows' real fix (behaviour, not recall) waits for T10.

- Under K30 option B: a detached or re-parented child, and a start through WMI or a scheduled task.
- The launcher's record folder rewritten by a script that builds its paths at run time (the launcher's header names it).
- K33's shell option in the owner's profile, if closed as a limit.
- K41's scoped run measures no test-only or deletion-only change; K38's 25 flips are run by file name, not by base.

## 9. Plan check, trial 2 of 3 (K20), 2026-11-13

One reviewer, the brief at workbench `results/sweep-vs-planning/probe/brief-premortem.md`, the design and the 1.28.0
code only. 17 findings before any code: 1 critical, 6 high, 8 medium, 2 low. Tokens: 179,361 (27 tool calls, about
5 minutes); trial 1 was 180,991. Each accepted line below is an acceptance criterion of this build.

| Id | Severity | Finding | Taken as |
|---|---|---|---|
| P1 | critical | K34's fix path was the same one tap | K34 redesigned (section 4): Never by a tool |
| P2 | high | K32's exemption let a PowerShell `*` reach dot names other than `.claude` | The exemption applies only when no protected name (.claude, .git, .githooks, .gitconfig, .config) exists at any depth the pattern reaches, links followed, and never for `.`, `..`, `~`, `$HOME`, `$PWD`, a variable or an unknown folder. Tests: `Remove-Item sub/*` with `sub/.githooks`, `sub/*/config` with `sub/.git`, a junction, `../*`: each Never |
| P3 | high | K30 option B does not hold a detached child | B's probe passes only if a detached child, an orphaned child and a WMI or scheduled start are all held on Windows; else A |
| P4 | high | `rules/git-and-release.md` is 13,996 of 14,000 bytes; K42 and K37 do not fit | K42's home is `rules/evidence-and-failures.md` (to check its room in step 4); K37's words replace the old title words, byte count stated before the recall run; no cap is raised |
| P5 | high | The scoped measure passes green on zero flips | A base that is not a commit or a diff that fails exits 2; zero flips reads "nothing measured"; tests for both. A change that only deletes lines takes the same zero-flip path, so under the owner's test bar it gets no test of its own |
| P6 | high | The value job turns a scoped run into a false cut list | The value job does not run on a scoped run; test |
| P7 | high | K34 collided with the owner-yes path for the list | Gone with the redesign |
| P8 | medium | K43 has no proof a pop-up clears a Claude Code permission block (the old line says the opposite) | The proof is the 1.28.0 thread's (a pop-up yes cleared the release-copy move and the installs); step 1 repeats it once here on a real block. If it fails, typed words stay for that case. Every copy of the old sentence changes in one pass |
| P9 | medium | K34 false holds in worktrees and on branch switches | Gone with the redesign |
| P10 | medium | CPU time misses a guard that waits on a child | As built after the sweep: on a machine of normal speed the clock alone decides, at 8 s, so a wait or a slow child fails as before; only on a machine measured slow does the guard's own CPU decide (children not counted), with the clock inside 10 s times that slowness |
| P11 | medium | The design left one of the two wall-clock sites alone | Step 1 names which site missed (the list says the 98 KB test, `guard-dispatch`); R4.2 gets the same runner-slowness factor |
| P12 | medium | The CPU report could put a test hook in the shipped guard | K14 changes no file under `project/.claude` or `user/kit-tools`: the report comes from a test-side `--require` preload |
| P13 | medium | The `base` input reaches git unguarded | Through `env:`, resolved with `rev-parse --verify --end-of-options`; a base starting with `-` exits 2 |
| P14 | medium | K30 B could hold the owner's own push from the app's terminal tab | B's probe records time per push and that the owner's terminal tab and a VS Code terminal are not held |
| P15 | medium | K36 lets a PR mint the rule its own test names | A rule id only in the PR's index is counted and named in the report as "rule added by this PR" |
| P16 | low | Upgrade window for K34's record | Gone with the redesign |
| P17 | low | Section 8 was short | Four lines added |

## 10. Build notes

### K38: the 25 surviving flips, each built and run (2026-11-13)

Lines are 7d7fdd0's. Tools: this thread's scratch `flipcheck.mjs` (flip a line, run the test files, restore) and
`diffcorpus.cjs` (every string in the six guard test files read as a Bash and a PowerShell command from two folders,
through the original and the flipped file).

- **14 killed by a test that fails with the flip in place.** owner-proof 61, 62 (a sed that is not a plain print),
  218 (a cd by -path), 241 (a default value), 269 (a name set twice ran for ever), 328, 331 (a cd after a break that
  is not plain), 355 (a quoted word); task-gate 98 (letter case by platform); owner-yes 121, 134 (a transcript line
  with no message), 255 (the push question as a command); guard 41 (the kit's own Claude folder), 81.
- **Two of those were already caught by tests the measure did not tie to the line:** owner-yes 255 and guard 81 go
  red in tests that existed at 7d7fdd0. The coverage map missed them (the line runs in a child process the test
  starts), so the measure overcounts survivors on such lines. A fact about the measure, noted for K41.
- **5 equal by a run:** owner-proof 97 (a pattern that cannot fail to build), 107 (a cache bound), 240 (array
  elements: every case is held by another rule), 301 (a cache key's label), 460 (a leading slash the path reader
  drops). 13,048 readings each, 1,877 of them holds, 0 differ; the control (line 61) differs in 8.
- **6 equal by their consumer:** the `return null` to `return undefined` flips (owner-proof 480, 485, 495;
  owner-yes 47, 110; task-gate 102). The dispatcher reads null and undefined alike, which a test now pins (a merge
  of one undefined and one null answer is null); owner-yes's callers test truth only.

### The owner's calls after the lock (2026-11-13)

- Nothing rolls over from 1.29.0: every finding of this build and its sweep is fixed here, low and medium too.
- A failing-first test is owed only where a fix changes behaviour (rule:test-value). The sweep's findings are held
  to that bar.
- Both were written into the rule text and pulled again with the rest of it when recall did not pass (below); this
  build still works by them.
- Three restated or snapshot test lines cut on the owner's yes (R6.4, R6.5, R6.6).

### Row by row

| Row | Result |
|---|---|
| K14 | Built, then tightened by the sweep. On a machine of normal speed the 98 KB test fails past 8 s by the clock, as before; only on a machine measured slow (an idle node start against 150 ms) does the guard's own CPU under 8 s decide, with the clock inside 10 s times that slowness. Proof on the owner's PC: 9 s of work, a 12 s wait and an 8.5 s wait each fail. No guard file changed |
| K41 | Built. `mutation-check --base` resolves the base first (a bad one exits 2), says "nothing measured" on no flip, and `--count` prints the flips without running one; the workflow measures the change by default, prints flips and minutes first, runs the whole kit only by hand, and sorts tests only then. Found on the way: `test-value.mjs` dropped its first file when run with no `--out`; fixed |
| K36 | Real the other way round: the index read is the change's own copy. A rule the change itself adds is counted and named in the report |
| R6.2 | Real. No test reached the refusal of a used tap; one does now, and it kills both flips on that path |
| R6.4, R6.5, R6.6 | One behaviour test added (the installed guard names its Claude folder), one test renamed to what it proves, three lines cut |
| J8 | Each CI gate mapped to a test of its bad case. One gap: the link scan had none; it has one now. The workflow lint is a pinned outside tool and has no planted case of its own |
| S18-4 | Not real now: every mention of `approve.mjs` in the rules and role files carries its folder |
| K34 | Built as redesigned: the folder list is never written by a tool. After the sweep, install also records it outside the project, as it records a host's own hook: gone, changed or not yet recorded, every call is held; the owner accepts a change in their own terminal, and install refuses that flag in a shell an AI tool started |
| Found in build (high) | A protected file named with a trailing dot or space, or a stream suffix, was not read as the file. Reproduced on disk and on the released 1.28.0 (PowerShell wrote the settings with no hold). Each path part is read as the file Windows opens. Older than this build; every project on Windows |
| K32 | Built. A PowerShell wildcard under plain folders is no hit when the folder, read from the disk, holds no dot name, no kit- name and no link at any depth; only in a command of one statement, of plain printable text. A backslash in PowerShell is no longer read as a quote |
| C13 | Reproduced live: past 200 characters Claude Code keeps 200, a dash and a short hash. Such a folder is matched by its 200 characters. On 1.28.0 a long-path project whose shell stood outside it was not found |
| K35 | Not real: a project that tracks its own file at the reader's path has every call held and its file never run (probe on this branch, 2026-11-13). No test added: nothing changed |
| I6 | The fetch and push compare is built: a feature push asks when origin pushes somewhere it does not fetch. "BOM ledger" and "owner allow-list" name `autonomy.mjs`, which the merge gate replaced: closed. `--amend-outcome` was a convenience nobody has needed since 1.16.0: closed, the owner's to reopen |
| K30 | Probe: a lookup of the parent chain takes 430 to 710 ms and finds Claude Code for a direct child; a detached child whose parent has gone finds nothing. The bar (hold a detached child) fails, so by the owner's pick it is a named limit (the header of `project/.claude/guard.cjs`) |
| K33 | Named limit, same line |
| K42, K43, C17, K37 | Rule text. Written, measured three times, and pulled: see the recall record below. Not shipped in 1.29.0. They stay open on the list for the build that follows the owner's ruling on recall question 4; the wording is kept as three patches for that build |
| K17, M27 | Measured, not built: K17 on this build's PR run, M27 from this sweep's count of new spellings (section below) |
| K39, I19 | The owner's calls 4 and 5 of section 6: K39 closed as unnamed (this sweep ran the same two roles); I19 left as it is until recall is reworked |

### The sweep (2026-11-13, one sweep, seven reviewers, the owner's yes)

Report: `reports/sweeps/2026-11-13-1.29.0.md` (local). Every finding was fixed in this build or put to the owner;
a test was added only where a fix changed behaviour. The highs, each reproduced by its reviewer before the fix:

- The folder list read only from the project could be dropped by a branch switch, a reset, a stash or a clean
  (two reviewers; the git check written for it missed a branch whose last commit did not touch the list, and
  froze a project that had removed its list on purpose). Now recorded by install.
- A move or a copy into `.git` (`Move-Item pay/* .git`) landed a config or a hooks folder there. `.git` named as
  the place written to, its worktrees and `.ssh` are held.
- A device or share spelling of a local path (`\\?\C:\...`, `\\localhost\C$\...`) wrote inside a listed folder.
  Read as the local path; a share or device path that cannot be placed is held while a list exists.
- A setting that carries the push (`core.sshCommand`, a proxy, the certificate check, the credential helper)
  sent a feature push to another host with origin's URL untouched. Changing one now asks, as changing the URL does.

The spelling race (M27): this sweep found 4 new spellings of a write the guards missed, against 8 at 1.28.0 and
11 at 1.21.0. Slower, not ended.

Named limits, each put to the owner: a PowerShell shell that keeps its own folder between calls; a race between
two calls; a name with a full stop after it in prose (an echo or a heredoc line ending in a protected file's name
is now held, as the same line without the stop always was); the Windows name rule on macOS and Linux (a file
really named `settings.json:x` there asks).

### Recall record (2026-11-13, local runs, the owner's yes for each round)

One blind scorer per round, brief v2. Each run is 13 fresh sessions; a round of 7 runs took about 11 minutes.

| Round | Candidate text | Candidate | Baseline (1.28.0) | Control | What failed |
|---|---|---|---|---|---|
| 1 | The first wording: "only a high or security hole that cannot be finished carries" | 11, 11, 12 | 12, 12, 13 | 0 | Question 12 in 3 of 3: sessions read it as "yes, a high can carry". The rule had been made looser than the released one |
| 2 | "What cannot be finished carries only on the owner's yes"; keys v6 for question 12, on the owner's yes | 11, 11, 12 | 12, 11, 12 | 0 | Question 12 in 3 of 3 again ("yes, with your yes" where the key wants a flat no) |
| 3 | "A high or critical never carries" | 11, 12, 11 | 11, 11, 12 | 0 | Question 12 passes in 3 of 3. Question 4 (push and PR) misses in 3 of 3 |

Then a probe of question 4 alone, 8 sessions a side, one blind scorer: the released 1.28.0 passes 3 of 8, this
build's text 4 of 8, a stronger wording of the short outward-acts rule 3 of 8. So the rule text of this build did
not move question 4, and no wording tried lifts it: the question passes under half the time on the released kit
too, mostly on whether the answer says the act is named and that the yes comes by pop-up. With one question that
unsteady and a bar of 12 of 13, a median of 12 needs every other question right in two runs of three.

By the rule agreed before the probe (no clear lift: pull the rule text, no more runs), every rule line of this
build and keys v6 are pulled. The gate was not lowered and no line was recorded as passing. What recall is owed
before the next rule change: a ruling on question 4 (the key or the rule), which is the owner's.

## Progress

- [x] Step 1 probes
- [x] Kit-only work
- [x] Guard work
- [x] Rule text and recall (written, measured, pulled)
- [ ] Release prep, sweep, PR
