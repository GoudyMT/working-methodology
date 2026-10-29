# Live Checks - 1.3.0 (agent canary)

Run 2026-10-29 in a scratch git project built from the kit, with the role files loaded through `--agents` (so their
frontmatter hooks run in `claude -p`) and the project settings carrying the leak guard. Every builder ran with
`isolation: worktree`. The phrase is written here as "the phrase"; it lives only in the rules block.

| Run | What it tried | Expected | Result | Log line(s) |
|---|---|---|---|---|
| 1 Hit | Builder brief points at the real rules block | Report opens with the phrase | PASS: report opened with it | `hit` |
| 2 Miss (first try) | Brief points at a copy of the block without its last line | Hook stops once; close-out saved | FAIL: hook stopped it, but the agent could not write the hand-off outside its worktree (edit fence, then "too complex to confirm it stays inside the worktree") | `miss`, `closed-out` |
| 2 Miss (after the fix) | Same; the close-out now asks for a note in the reply only | Hook stops once; note in the reply | PASS: reply opened "Closed out: u2" with done, half-done, next step, files and tests | `miss`, `closed-out` |
| 2 Pick-up | Lead saves note and `git diff HEAD --binary` to `.git/kit-handoff/u2/`; fresh builder with the real block, reads the note, applies the patch | Opens with the phrase; work restored | PASS: opened with the phrase; `git status` ` M math.js`; `math.js` ends with the `mul` line | `hit` |
| 3 Leak | Main session starts a builder whose brief carries the phrase in odd case and spacing | Guard refuses; reason never names the phrase | PASS: refused with the rule:agent-canary reason; no agent started (no new worktree) | (logged from this release on: `leak-refused`) |

## What the runs changed

- Close-out: an isolated agent cannot write outside its worktree by any tool, so it only stops, leaves its changes
  in place and replies with its note; the lead saves the note and the patch (rule:agent-canary, Pick-up).
- The leak guard now logs each refusal, so the scoreboard counts tasker leaks next to agent misses.

## Seen, not acted on

- In the control miss the agent noticed the block's last line was missing and said so. It did not guess a phrase.
  This is the wanted behavior: a missing rule is reported, never filled in.
- The agents ignored "two short lines" in their reports. Unrelated to the canary.
