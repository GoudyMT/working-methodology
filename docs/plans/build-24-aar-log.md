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
