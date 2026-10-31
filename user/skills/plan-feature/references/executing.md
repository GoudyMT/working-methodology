# Executing a Plan Inline

Loaded by Step 7 when the lead builds the plan itself. An agent-team build uses the agent-team-build skill
instead. The plan already did the thinking: execute it exactly, prove each step with a test you watched fail
and then pass, and leave a record that survives a compact.

## Setup

1. Branch first (rule:branching); never build on `main`.
2. Read the plan and the design it names. The design is the authority; conflicts inside the plan resolve
   against it. A plan with no reachable design gets a note in Execution Notes & Deviations: rulings made
   without one are provisional.
3. Read the `## Progress` block. Tasks ticked there are done - their commits exist in `git log` even when you
   do not remember them; resume at the first unticked task. After a compact, trust the plan file and git over
   memory (rule:post-compact-orientation).
4. **Pre-flight interface scan:** for each task that consumes what an earlier task produces, compare the
   Produces line against the Consumes line. Record one line per pair in Execution Notes, with any mismatch and
   its ruling. No shared interfaces -> one line saying so.

## The task loop

1. **Take the task:** re-read its full text from the plan, every time - memory holds a summary; the plan holds
   the exact values. Update Progress "Current task".
2. **Work the steps in order** under rule:tdd. The test is written and run first; watching it fail is a step,
   not a formality. A test that passes before the code exists is a finding about the test.
3. **Compare every check to its expected result.** Three outcomes:
   - **Matches** -> next step.
   - **The code is wrong** -> rule:failure-response: dump real state first; never patch the symptom to make the
     output match.
   - **The plan is wrong** (a step contradicts the design, an interface does not match, a command cannot
     work) -> if the fix is mechanics (a typo, a wrong import, a name mismatch against an earlier task's
     Produces line), take the smallest change that satisfies the design and record it as
     `Task N: Ruling: <finding> - <what I did and why> - <cost if wrong>`. If it is a choice (a new name,
     format, behaviour, file, or anything outside the plan), stop and ask (the Self-Correction Boundary in
     rule:loop-workflow-mode). Tests never yield (rule:test-integrity).
4. **Commit** as the plan's commit steps say, through the commit hook. Bookkeeping rides with work: the
   Progress update goes in the same turn as the commit, not in a turn of its own.

Keep context lean: send long test output to a file and read its tail.

## The completion contract

A task is ticked only when all of these are true, with evidence from this session, not inferred from a diff
that looks right:
- every test the task names exists, ran in this task, and you read the output;
- the task's final suite run passed, and its command and result are written into the Progress line;
- every expected result in the task was compared against real output;
- every deviation from the task text has a Ruling line.

Missing any -> the task is not done; finish it.

## When to stop and ask (and only then)

The approved plan is approved scope, so do not pause to ask "should I continue?" between tasks. Stop for:
- a choice the plan and design do not settle (see the task loop, outcome 3);
- an irreversible or destructive act, or anything touching security or personal data beyond the plan;
- an outward act - push, PR, merge, release, a message outside the project (rule:outward-acts);
- a plan so broken that every path forward is a guess (rule:re-plan-on-failure);
- any hard stop the project adds (Tier 0, a budget raise, a spec or ADR change, a visual without a locked
  wireframe).

## After the last task

1. The full gate (rule:ci-gate), green on every step.
2. Parking-lot triage (rule:parking-lot); the lot ends empty.
3. The sweep at the plan's tier (the pre-pr-sweep skill). The reviewer is a fresh context, never the author's
   own read of the diff; give it the plan's Review Focus lines and point it at the Ruling lines.
4. **Grade findings by effect:** a finding's weight is what a real user gets if it ships, not whether the
   design happened to name the input that triggers it. Then run every finding through rule:finding-pipeline
   (a finding is a hypothesis; fix roots; one root per commit; each fix proved by a test that failed first).
   Small and easy findings are fixed now, not deferred (rule:autonomous-fixes, rule:features-first).
5. The re-sweep its tier calls for, then the pre-push op-test where it applies (rule:pre-push-op-test).
6. Close with the rundown (rule:delegated-decisions). Under `Decided alone`, list every Ruling line in the
   order made, each with its cost if wrong, and every finding deliberately left with where it is recorded.
   These lists are complete: the rundown is the only place the owner sees the calls you made for them.

## Excuses that do not hold

| Excuse | Reality |
|---|---|
| "I remember what Task N says" | You remember a summary. Re-read the task. |
| "The code is clearly right; skip watching the test fail" | A test never seen failing proves nothing. |
| "I will run the suite once at the end" | Per-step runs show which step broke it; the end run is the contract, not a substitute. |
| "I will update Progress after a few tasks" | A compact does not wait. One line per task, with its commit. |
| "My own careful read replaces the reviewer" | Same author, same blind spots. The fresh reviewer is the floor. |
| "The reviewer said minor, so it is minor" | Grade by what the user gets, then decide. |
| "The fix is obvious; no failing test needed" | The failing test is the only proof the finding was real and is gone. |
