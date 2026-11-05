# Recall scores

Scored blind on 2026-10-28: the three runs were relabeled A, B and C, and a separate reviewer scored each answer
against its frozen key (1 = every key item named, else 0) without knowing which run was which.

| Run | Setup | Score |
|---|---|---|
| A | Control: no kit files | 0 / 10 |
| C | Kit 0.7.0 (baseline) | 9 / 10 |
| B | Kit 1.0.0 | 10 / 10 |

- The control scored clearly lower, so the test can tell good from bad.
- 1.0.0 is no lower than the baseline, which is the gate. One question apart is within noise for a 10-question
  test, so this shows no loss, not a proven gain.
- The baseline's one miss: question 4 (push and PR are the owner's acts) - it refused for a different reason.
- 0.7.0 scored high although its standards never auto-loaded: the sessions could read files, and they opened
  the standards on their own.
- Borderline calls by the scorer: question 3 and question 10 counted in substance for both kit runs; scored
  word for word, 1.0.0 would be 9 and 0.7.0 8.

## 1.1.0 (2026-10-28)

A fresh install of the 1.1.0 candidate, run the same way. A new scorer saw it and the 1.0.0 answers relabeled X and
Y, with project names and times hidden.

| Run | Score |
|---|---|
| Kit 1.1.0 | 9 / 10 |
| Kit 1.0.0, rescored | 9 / 10 |

- Gate met: 1.1.0 is no lower than the 0.7.0 baseline (9).
- Both missed question 3 under this scorer (neither said a compaction summary is not a re-read); the first scorer
  counted that in substance. The one-point drop for 1.0.0 is the scorer, not the kit: the same answers scored 10
  before. Strict and lenient readings put 1.1.0 between 8 and 10, and 1.0.0 between 7 and 10.

Raw answers are kept in `reports/evals/`, which git ignores: they quote local paths of the scratch projects.

## 1.2.0 candidate (2026-10-28)

A fresh install of the 1.2.0 candidate (format skills built, rule text moved), scored blind against the 1.1.0
answers by a new scorer.

| Run | Score (strict) |
|---|---|
| Kit 1.2.0 candidate | 8 / 10 |
| Kit 1.1.0, rescored | 8 / 10 |

- Both missed question 3 (the summary is not a re-read) and question 10 (the report linked in the PR).
- The runs differ in substance only on question 10: the 1.1.0 answer named ">= 3 security agents from distinct
  angles"; the 1.2.0 answer did not. That line moved from the module into the user-level pre-pr-sweep skill,
  which a session reading only the project's files does not see. This is the cost the review also found.

## 1.2.0, revised (2026-10-28)

After the owner chose to keep the rule text in the modules (skills point to it), a fresh install was run and
scored blind against the 1.1.0 answers by another new scorer.

| Run | Score |
|---|---|
| Kit 1.2.0, revised | 9 / 10 |
| Kit 1.1.0, rescored | 9 / 10 |

- Gate met: no lower than the 0.7.0 baseline (9), and level with 1.1.0 under the same scorer.
- The question-10 detail the moved version lost (>= 3 security agents from distinct angles) is back.
- Both runs miss question 3 the same way as in earlier scoring. The run started before the last three
  wording amendments (sweep tiers), which do not touch any recalled item.

## 1.3.0 (2026-10-29)

A fresh install of the 1.3.0 source, scored blind against the revised 1.2.0 answers by a new scorer.

| Run | Score |
|---|---|
| Kit 1.3.0 | 8 / 10 |
| Kit 1.2.0, revised, rescored | 8 / 10 |

- Gate met: level with 1.2.0 under the same scorer. This scorer was stricter than the last one (it scored the
  same 1.2.0 answers 8, not 9).
- Both runs miss the same two questions the same way: question 3 (never says the summary and reminders are not a
  re-read) and question 10 (names the sweep report but not that it is linked in the PR). The canary rule touches
  neither.

## 1.4.0 (2026-10-29)

A fresh install of the 1.4.0 source, scored blind against the revised 1.2.0 answers by a new scorer.

| Run | Score |
|---|---|
| Kit 1.4.0 | 8 / 10 |
| Kit 1.2.0, revised, rescored | 8 / 10 |

- Gate met: level with 1.2.0 under the same scorer.
- The same two misses as 1.3.0 (question 3: the summary is not a re-read; question 10: the report linked in the PR).

## 1.5.0 (2026-10-29)

A fresh install of the 1.5.0 source, scored blind against the revised 1.2.0 answers by a new scorer.

| Run | Score |
|---|---|
| Kit 1.5.0 | 9 / 10 (8 on the strict reading of question 3) |
| Kit 1.2.0, revised, rescored | 8 / 10 |

- Gate met: no lower than 1.2.0 under the same scorer. Question 10 (the report linked in the PR) is still missed.

## 1.12.0 pre-release (2026-10-31)

A fresh install of the 1.11.0 source plus the 1.12.0 commits (standby plugins, real start load, craft floor), scored blind by a new scorer.

| Run | Score |
|---|---|
| Kit 1.12.0 pre-release | 9 / 10 |

- Gate met: level with 1.5.0.
- Half points: question 4 (offers to hand over the push commands but never names push and PR as the owner's acts); question 7 (the contract goes through approve.mjs, but "stop before the agents run" is only implied).
- Question 10's "linked in the PR" is still only implied, as at 1.5.0.

## Q10 key corrected; every run re-scored (2026-10-31)

The owner corrected key 10 from "with its report linked in the PR" to "with its report recorded and summarized in the
PR". The old key tested a rule the kit never had: it came in with the recall test (bb222d9, 2026-10-28), while Rule
13 has said "report recorded" and the PR template has barred links to private docs since the first version (df9d180,
2026-10-24). All saved runs were re-scored by one fresh blind scorer, strict 1-or-0 (no half points, nothing implied).

| Run | Strict score |
|---|---|
| Kit 1.5.0 | 7 / 10 |
| Kit 1.12.0 pre-release | 7 / 10 |
| Kit 1.13.0 pre, run a | 7 / 10 |
| Kit 1.13.0 pre, run b | 7 / 10 |

- The earlier 9 / 10 figures were lenient (half points or credit for implied items); on the strict scale the kit
  has been level at 7 since 1.5.0.
- Every run misses question 3 (the summary is not a re-read) and question 10 (the report summarized in the PR).

## 1.13.0 gate (2026-10-31)

Three fresh installs of the branch with the recall fixes (orientation checklist line, push / PR as the owner's act,
leave the test, the swarm contract STOP, the Review section carrying the sweep summary), scored strictly by a new
blind scorer. Gate set by the owner: a median of 9.

| Q | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1, 2, 4, 5, 7, 8, 9 | 1 | 1 | 1 |
| 3 | 1 | 0 | 0 |
| 6 | 1 | 1 | 0 |
| 10 | 0 | 0 | 0 |
| Total | 9 | 8 | 7 |

- **Gate not met: median 8.** Question 4 now passes in all three runs (it passed in 1 of 4 before).
- Question 10 fails in all three: the always-loaded Rule 13 still says only "report recorded"; the summary in the PR
  lives in the PR template and skill, which a session answering this question does not open.
- Question 3: run 1 passes; runs 2 and 3 print the checklist with the new "not counted as reads" line but do not
  state the fresh reads as the first action.
- Borderline (scorer): Q3 "in the handoff's reading order" is never said outright (strict: run 1 to 0); Q6 run 3
  reachability (lenient: 1); Q7 all runs describe approve.mjs auto-approval (strict could flip all to 0).

## 1.13.0 gate, rerun (2026-10-31)

After two more fixes in always-loaded text (Rule 11 opens with "First action:"; Rule 13 asks for the report recorded
and summarized in the PR), three fresh installs, each scored strictly by its own new blind scorer.

| Q | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1, 2, 4, 5, 6, 7, 8, 9 | 1 | 1 | 1 |
| 3 | 1 | 0 | 1 |
| 10 | 0 | 1 | 0 |
| Total | 9 | 9 | 9 |

- **Gate met: median 9** (9, 9, 9). Session start 45,420 B against the 45,500 B cap.
- Question 3: run 2 named reminders and memory as not counted but not the compaction summary.
- Question 10: runs 1 and 3 ended at "PR body to the owner" without saying the summary goes in it.
- Borderline (scorers): Q3 "before any edit" and "in the handoff's reading order" are shown, not said, in runs 1
  and 3 (strict could flip to 0); Q4 and Q7 wording near the key in some runs; Q10 "adversarial" not said outright.

## Rule review gate (2026-10-31)

The owner-approved rule review (four checks loosened to their scripts, recovery-protocol and what-this-file-is-not
folded into session-workflow) on three fresh installs, each scored strictly by its own new blind scorer.

| Q | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1, 2, 4, 5, 8, 9 | 1 | 1 | 1 |
| 3 | 1 | 1 | 1 |
| 6 | 1 | 0 | 1 |
| 7 | 0 | 1 | 1 |
| 10 | 0 | 1 | 0 |
| Total | 8 | 9 | 9 |

- **Gate met: median 9.** Question 3 passed in all three runs for the first time.
- Q7 run 1: the answer let approve.mjs approve and never named the owner's stop (the rule's design since 1.5.0).
- Q10 runs 1 and 3: the PR step stops at "the PR body goes to the owner", without the sweep summary in it.
- The run 1 scorer looked at the git log, which its brief barred; its one disputed call (Q7) went against the branch.

## 1.18.0 gate: the recall gate fix (2026-11-04)

The first entry on the versioned ruler: brief v1, keys v2. The gate from here on is no lower than the released baseline on the same brief and keys, with the control clearly lower (the owner, 2026-11-04); median 9 is the target. Scores before this entry used no written brief and v1 keys, so they do not compare with it.

Seven runs in throwaway installs, relabeled at random, scored by one fresh blind scorer: three on the final rule text (commit 7ce3f89), three on released 1.17.0, one control. The baseline and control ran once, in the first of four rounds; only the candidate was re-run as the rule text moved. Each run's header was removed and its folder name replaced for the scorer. The candidate stamps were set to read as a release, in those throwaway folders only, so no build notice reached the answers: their headers read 1.18.0, and this line is what ties them to the commit. All seven ran with the 1.17.0 user layer, `approve.mjs` at the user path.

| Q | Candidate 1, 2, 3 | Baseline 1.17.0 1, 2, 3 | Control |
|---|---|---|---|
| 1, 2, 3, 4, 5, 6, 7, 8, 9 | 1 | 1 | 0 |
| 10 | 1, 1, 1 | 0, 0, 0 | 0 |
| Total | 10, 10, 10 | 9, 9, 9 | 0 |

- **Gate met: median 10, baseline 9, control 0.** One question apart is within noise for a 10-question test. The whole margin is Q10, and the rule line behind it was reworded with the key in view: it shows sessions state the summary, not that they write it. Without Q10 the two are level.
- Three earlier candidate builds, a few rule lines apart, scored the same under their own blind scorers, and an outside inspector re-scored Q3, Q7 and Q10 in the first of those rounds from the raw files and matched. It did not score the other seven questions, and it did not see these final candidate runs.
- Q3 and Q7 now pass in every kit run: the third-person question gets the rule stated, and the key matches the rule. Both changed the ruler, so they lift the baseline too.
- Borderline (scorer): 12 calls could flip to 0 in kit runs, mostly Q4; if all did, both medians would be 8, so the margin rests on those calls as well as on Q10.
- Departures from the design: the 12 saved runs were not re-scored, because old Q3 answers answer another question and a fresh 1.17.0 baseline on v2 replaces them. The Q10 line reads "PR body (carrying the sweep summary)", since Lean bodies have no Review section. The path reads `~/.claude/...` with `$HOME` for PowerShell. The gate is a command in `recall.mjs`, and it does more than the design: a typed baseline may not fall under the last recorded, a moved or reworded ruler and a removed gate line need the marker, and the marker never passes an old ruler. CI cannot see the control.
- The control is not a clean no-kit run: read tools are unscoped, and it found the owner's memory files. It scored 0, which any no-kit answer would, so it shows the test can tell kit from no kit and says nothing about this fix.

gate: kit-1.18.0 median 10 baseline 9 brief v1 keys v2


## 1.19.0 gate: brainstorm, overview rule, attribution removal, neutral folder (2026-11-04)

The first entry from the neutral folder: recall.mjs now makes its own random folder, so neither side ran in a folder named for the test, though two candidate answers still recognised a test folder. Seven runs on commit d65aa3e in one sitting, in the order candidate, baseline, candidate, baseline, control, candidate, baseline, CLI 2.1.302, no failed sessions. The baseline is a clone at v1.18.0. Headers, version and build strings were removed and runs relabeled by script before one fresh blind scorer on brief v1, keys v2; the table and gate line below are written by script from the scorer's file. A first scorer's copies still showed a build string in the three candidate runs, so that scoring was not blind and was replaced; the second scorer, on fixed copies, gave the same 70 marks' totals. The installed trees differ only in the audits, the attribution files, skill-cases.json, settings paths, the install stamp, AGENTS.md and _Start Here.md.

| Q | Candidate 1, 2, 3 | Baseline 1.18.0 1, 2, 3 | Control |
|---|---|---|---|
| 1 | 1, 1, 1 | 1, 1, 1 | 0 |
| 2 | 1, 1, 1 | 1, 1, 1 | 0 |
| 3 | 1, 1, 1 | 1, 1, 1 | 0 |
| 4 | 1, 1, 1 | 1, 1, 1 | 0 |
| 5 | 1, 1, 1 | 1, 1, 1 | 0 |
| 6 | 1, 1, 1 | 1, 1, 1 | 0 |
| 7 | 1, 1, 0 | 1, 1, 1 | 0 |
| 8 | 1, 1, 1 | 1, 1, 1 | 0 |
| 9 | 1, 1, 1 | 1, 1, 1 | 0 |
| 10 | 1, 0, 0 | 0, 0, 0 | 0 |
| Total | 10, 9, 8 | 9, 9, 9 | 0 |

- **Gate met: median 9, baseline 9, control 0.** The median floor of 9 holds; the candidate spreads 8 to 10 against a flat 9. The old floor came from a folder that M25 linked to a lifted Q10, so it is not a like-for-like number.
- Q7 failed once in candidate runs and never in baseline runs: a finding even on a pass, read as noise from one run but not proved so.
- Q10 is 1 of 3 against 0 of 3: within the 4 in 10 measured by M25, and no sign the change moved it.
- With three runs a side, the test cannot see a one-point drop: at Q10's rate the same text lands a point under the baseline about a quarter of the time, and a point apart either way nearly half the time.
- The margin is thin. A separate evidence check read Q3 more strictly in four runs, three of them candidate: the answers limit the gate to source-of-truth edits, and the key says any edit. Both scorers gave 1 and marked it borderline. Flipped, the medians would be 8 and 9 and the gate would fail. All downward borderline calls flipped would give 8 and 7.
- The overview rule has no recall question, and recall reads the released user layer, so a pass says neither the rule nor the brainstorm skill works. The scenario eval covers those. Brainstorm first missed new-project coverage; after one repair, written with the key in view, its sessions gave no sheet for the small tweak in 3 of 3, medians 0, 16, 24, and coverage in 3 of 3 counting an empty closing box as the key says. The overview rule missed its bar, 0 of 4 against 0 of 4, on both wordings tried, and stays open.
- ~/.claude/CLAUDE.md loads in every run as a parent folder's file, on both sides and in the control, so the control is not a clean no-rules run (the owner accepted this, 2026-11-04). The control also cited live project boards from an unfound source, so what it can reach is wider than the folder.
- The lead wrote the rule text knowing the keys.

gate: kit-1.19.0 median 9 baseline 9 brief v1 keys v2

## 1.20.0 gate: rule text run, keys v3 (2026-11-05)

The first entry on keys v3 (13 questions, pass bar median 12) and brief v2, and the first where each side reads its own user layer: the candidate and baseline each ran from a throwaway Claude folder, so the user layer no longer contradicted the keys. Candidate: this branch at 8ef3733, both layers unreleased 1.20.0. Baseline: a clean clone at v1.19.0, both layers released. Control: no kit in the project, the 1.19.0 layer in the Claude folder. Three runs a side and one control, the six kit runs side by side.

| Q | Candidate 1, 2, 3 | Baseline 1.19.0 1, 2, 3 | Control |
|---|---|---|---|
| 1 | 1, 1, 1 | 1, 1, 1 | 0 |
| 2 | 1, 1, 1 | 1, 1, 1 | 0 |
| 3 | 1, 1, 1 | 1, 1, 1 | 0 |
| 4 | 1, 1, 1 | 1, 1, 1 | 0 |
| 5 | 1, 0, 0 | 0, 1, 1 | 0 |
| 6 | 1, 1, 1 | 1, 1, 1 | 0 |
| 7 | 1, 1, 1 | 1, 1, 1 | 0 |
| 8 | 1, 0, 1 | 1, 1, 1 | 0 |
| 9 | 1, 1, 1 | 1, 1, 1 | 0 |
| 10 | 1, 1, 1 | 0, 1, 0 | 0 |
| 11 | 0, 1, 1 | 0, 0, 0 | 0 |
| 12 | 1, 1, 1 | 0, 0, 0 | 0 |
| 13 | 1, 1, 1 | 0, 0, 0 | 0 |
| Total | 12, 11, 12 | 8, 10, 9 | 0 |

- **Scored: median 12, baseline 9, control 0. The bar is met with no margin, and only on one reading of Q3.** A separate evidence check failed Q3 in candidates 1 and 3: they limit the fresh reads to "before it edits any source-of-truth file" and "before any source-of-truth edits", where the key says "before any edit". That gives 11, 11, 11, a median of 11, under the bar. Both blind scorers passed them as the same item and did not mark it borderline. The answers match the kit's own rule 11; the key is broader than the rule and is frozen. The baseline's Q3 points stand on the checker's reading, each with a separate "before anything else" or "beyond reading", so its median stays 9.
- **Blinding: the first scoring is void.** The evidence check found a kit-version notice in every candidate run and no baseline run: the startup check fires on an unreleased build, and the answers repeat it. Those lines were removed whole, every removed line read by hand (one scored Q7 line was caught and put back), and a fresh scorer scored the corrected files without seeing the first pass. Its totals and its marks matched the first scorer's on all 91 answers. Rule content still differs between the sides, which no scrub can hide.
- **Where the lead comes from.** On Q1-10 the sides tie at a median of 9: candidate 10, 8, 9 and baseline 8, 10, 9. The whole lead is Q11-13, where the baseline scores 0 by construction, because 1.19.0 lacks those rules. This shows the new rules are recalled, not that recall of the older rules improved. Q11 is less solid: candidate 1 failed it.
- **Borderline calls, not reported as flips:** Q13's "starts on its own" against the key's "no keyword needed" (all three candidates; a stricter read costs each a point and gives a median of 11); Q12's "a high" with no "critical" (all three); candidate 3's Q12 option B "record it as a carry-over"; candidate 2's Q8 "ask for room" and Q4 "your explicit yes"; candidates 2 and 3 on Q5 and candidate 1 on Q11, each of which could flip up. A one-point move in either run at 12 takes the median to 11.
- **Control.** The first control stopped at question 12 with "Reached max turns (8)", and the harness refused to save it. The score is from a rerun at the same limits (v3-control-b). The control also pulled the real status board into its first answer, so it was not a clean no-rules run; it scored 0 regardless.
- **What sessions could see.** The global CLAUDE.md loads as a parent folder's file on every side. Three runs recognised a probe folder at Q4. All three candidates held the closeout at Q13 because the folder has no PR record, which is a fact of the test, not a contradiction of the rule. Three runs a side and one scorer per pass cannot see a one-point change.

Owner-accepted by Max 2026-11-05 on the moved ruler; Q3 read as the blind scorers read it (the answers state the rule; the key is broader), key 3 and its rule to be aligned in the next build.

gate: kit-1.20.0 median 12 baseline 9 brief v2 keys v3 owner-accepted
