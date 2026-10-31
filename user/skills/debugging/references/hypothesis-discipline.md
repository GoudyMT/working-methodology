# Hypothesis discipline

Used by steps 7 and 8. Why: one variable at a time is the only way to know what worked.

## The loop

1. Write: "I think X is the cause because Y." Specific, falsifiable, one sentence.
2. Name the result that would prove it wrong before you run anything.
3. Make the smallest change that tests it. One variable.
4. Run. Read the actual output.
5. Confirmed -> go to the failing test and the single fix. Wrong -> revert the change and write a new
   hypothesis from what the run taught you. Do not leave the failed change in place.

## Pattern comparison (step 7)

- Find a working twin in the same codebase; read it end to end, not a skim.
- If you follow a reference pattern, read all of it before adapting any of it.
- List differences between working and broken, including config, versions, ordering, environment. Do not
  decide "that cannot matter" without a check.
- List what the code depends on: settings, services, assumptions about input.

## Counting attempts

Keep a visible tally of fixes tried. Two misses: stop and dump state. Three misses, or every fix surfaces a
new problem in another place, or a fix needs a large rewrite: the structure is suspect (shared state, tight
coupling, a pattern kept out of habit). Bring it to the owner as a re-plan with options; do not try a fourth.

## Rationalizations and their answers

| Thought | Answer |
|---|---|
| Too simple for a process | Simple bugs have causes; the process is quick on them |
| Emergency, no time | Guess-and-check is slower than a trace |
| Try this first, investigate later | The first fix sets the pattern; do it right |
| I will test after it works | An untested fix does not hold; test first |
| Several fixes at once saves time | You cannot tell which worked, and you add new bugs |
| I see the problem | A symptom seen is not a cause understood |

## When the owner redirects you

"Is that happening?" means you assumed. "Will it show us?" means you skipped instrumentation. "Stop guessing"
means a fix came before understanding. Each one -> return to step 2.
