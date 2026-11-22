# Build 24 after-action log

Running log for the owner's after-action report on the build flow (lanes, Haiku testers and builders, one Sonnet
test review, one fix pass, Opus only on risky units). Folded into the build record at release prep.

## 1. Unclear, stopped, asked or guessed

| When (UTC) | Unit | Agent | What happened | How it was resolved |
|---|---|---|---|---|
| 11:5x | U7b | Haiku builder | Stopped: brief said run git through safe-spawn, the locked fixture copies no audits/ file | Lead picked the inline pattern in one message |
| 11:5x | U7b | Haiku builder | Stopped twice on a tool refusal of compound shell commands | Lead: plain single commands; split once before stopping |
| 12:0x | U7b | Haiku builder | Stopped: rule map stale, the fix file was outside its list | Lead ran the rule map write |
| 12:1x | U2b | Haiku tester | Guessed: wrote its run summary as a finding line, not a note line | Lead restated the record shape in the next brief |
| 12:2x | U8 | Haiku tester | Ended twice without delivering its report | Lead read the commit and ran the file itself; third ask delivered |
| 12:2x | U5 | Haiku tester | Guessed: printed names are family words for known ids, config string otherwise | Reviewer judged it consistent; flagged as an unwritten rule |
| 12:3x | U11 | Haiku tester | Flagged: the CI job needs a test map the PR does not carry | Lead ruled: report mode exits 0 with a note; the job builds the map |
| 12:4x | U4 | Haiku tester | Asked three open questions instead of guessing (owner-yes lift, guard vs pre-push, red sha role) | Lead answered in one message |
| 13:0x | U6 | Haiku tester | Stopped before writing with six spec questions (file formats, the open status, reject or not) | Lead answered in one message; the lead's brief had left the file format open |
| 13:2x | U4 | Haiku builder | Stopped on a wrong locked test (owner tap dated in the future) with proof, instead of working around it | Lead sent a retest: fix to the tester; the push waits for the owner's yes (call 3) |

| 14:4x | U4 | Haiku builder | Stopped when the permission check refused a break check that disabled a hook's yes check | Lead: break checks are skipped on guard files; the no-yes refusal rows stand in |

## 2. Drift from L1 to L13 and how it was caught

| When (UTC) | Rule | Drift | Caught by |
|---|---|---|---|
| 11:41 | L9 | Opus checker looped 3 to 7 rounds per unit (U1 to U3) | The owner |
| 12:14 | L1 | First lane map had U4 and U10 on one file at once | plan-graph.mjs (script) |
| 12:19 | L1 | U15 placed beside U4 on the build skill file | plan-graph.mjs (script) |
| 12:1x | L11 | U2b tests went into shared test files (written before the lanes rule) | Lead, accepted as in flight |
| 12:2x | - | U7b builder wrote a temp file through a linkable folder and ran project code | Automated security review, then the Opus check |
| 12:1x | - | The test-check step in CI reported tests "not measured" while red tests sat on the branch | Lead (expected mid-build; clears when green) |
| 12:4x | - | A queued fix-round message to a busy agent never started; found 30 min later | Lead, by checking the worktree (a floor-manager moment: a checklist would have shown it) |
| 12:4x | L10 | U9 builder added an untested enforce branch that refused every built-in agent when holds.json was damaged | Opus check on the risky unit (probe) |
| 13:1x | - | The read-only Sonnet reviewer wrote a temp test copy into the lead's checkout, deleted it and reported it | Its own report (no tool fence on a general-purpose agent; the test-reviewer role file would have blocked Write) |
| 12:1x | L3 | The commit-shape fix went to the U7b builder (its own builder had been stopped) | Lead, by choice: warm agent, under 3 units |

| 14:1x | L6, L16 | A lead note (second review, lead answer) is text in the agent's own record, so an agent can forge it | Opus check on U15; ruled a log-stage limit, a lead-only file is a build 25 item |

| 14:3x | L13 | The retest yes was built for the owner's terminal only, not the pop-up path the owner picked; its test faked the terminal env, so it passed | Lead, reading the hook before the first push; fixed as the unit's round 2 |

## 3. Lead context and handoffs

| When (UTC) | Stage | Lead context | Handoff |
|---|---|---|---|
| ~11:35 | U1 to U3 built, U7b tests | 92 percent | Compacted; resumed from the summary |
| 12:30 | Four lanes running | about 30 percent | none |

## 4. Per-role time and cost (filled at release prep from the agent logs)

## 5. Where a floor manager would have helped

- Every stop and question above went to the lead and was answered in one message; none needed the whole plan
  beyond what the lead holds. The lead is the floor manager today.
- The cost the lead carries is context: each relay, review and merge adds to it, and the lead compacted once at
  92 percent. A separate manager would help most as context relief, not as more oversight.

- 2026-11-22: writer stopped before naming 566 tests (about 566 changelog lines under A7). Owner picked: cut tests first, after the smart test strategy lands. Push and CI wait on that cut.
- 2026-11-22 (lead miss): the U19-U22 briefs gave why lines "S1: ..." and "doc claim: ...", which the kit shape check (whyFault, A6) rejects; caught by the U21 builder. Fixed by a why-line retest and a whyFault change accepting the three exempt shapes.
- 2026-11-22 (lead miss): ran the full unbudgeted test check locally without sampling CPU/GPU load or asking Max first (machine-load rule). No harm seen; next heavy run samples load 3 times and asks.
- 2026-11-22: 1.50.1 approval took about 23 min (9:35-9:58 PT): two FIX THE CONTRACT reruns from lead errors (unknown role kinds; approver reads only the main checkout, branch was in a worktree), pause resume with one retry (session id missing from the hand step). approve.mjs runs 1-3 min each. Build 25 rows: approver that reads a linked worktree; resume hand step names the session id.
