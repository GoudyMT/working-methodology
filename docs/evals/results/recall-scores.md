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
