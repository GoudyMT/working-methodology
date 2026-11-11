---
name: debugging
description: Find and fix the root cause of any bug, failing or flaky test, build break, surprising behaviour or production incident, one hypothesis at a time. Use when something fails, errors, hangs, regresses, "works on my machine", is flaky or slow, or when production is down or degraded. Serves rule:failure-response.
---

# Debugging

Serves rule:failure-response (evidence-and-failures rules). Read it first: step 0 (rule out a stale kit), triage,
diagnose with data, verify before push. This skill adds the method for steps 2 and 3, and the incident path.
It never restates the rule, and it never weakens a test to get green (rule:test-integrity).

## When it applies

Any failing test, build break, wrong output, crash, hang, flaky run, slowdown or live incident. Most of all when a
fix looks obvious, time is short, or an earlier fix did not work. Why: guessing is fastest only when it is right.

## The law

No fix before the cause is known and written down as one sentence: "X happens because Y." A fix on a guess hides
the bug and adds a new one. If there is no cause after honest work, say "I do not know" and report what was
ruled out. Why: a confident wrong cause costs more than an honest gap.

## Steps

1. **Run rule:failure-response steps 0 and 1.** Done when: the kit is current (or the fault persists on a
   current kit) and the failure is triaged as production bug, test artifact or out of scope.
2. **Read the evidence whole.** Full error, full stack, every line number and path, the log file behind an
   empty CLI error. Done when: you can quote the first failing line, not just the last one.
3. **Reproduce on demand.** Exact steps, same data, same environment. Not reproducible -> gather more data
   (logs, inputs, versions); do not guess. Done when: one command or action shows the failure every time, or
   you have named how often it fails and under what load.
4. **Check what changed.** Last commits, dependency and config changes, environment differences, deploys.
   For a regression, bisect (`git bisect`) instead of reading. Done when: the first bad change or state is
   named, or "nothing changed" is shown with evidence.
5. **Dump real state at each boundary** (rule:failure-response step 2). In a system of several parts, log what
   enters and leaves each part, and whether config and secrets arrive, in ONE run. Done when: the log shows
   which boundary first holds a bad value. Detail: `references/trace-and-instrument.md`.
6. **Trace backward to the source.** From the bad value ask what produced it, then what called that, until
   the original trigger. Fix there, not where it shows. Done when: the chain from trigger to symptom is
   written out. Detail: `references/trace-and-instrument.md`.
7. **Compare with something that works.** A similar working path, an older version, a reference. List every
   difference, small ones too. Done when: the differences are listed and none was dismissed unchecked.
8. **One hypothesis, one change.** State it, change the one thing that tests it, run. Wrong -> undo it and form
   a new one; never stack a second change on a failed one. Done when: the hypothesis is confirmed or dead.
   Detail: `references/hypothesis-discipline.md`.
9. **Write the failing test first** (the smallest reproduction; the project's testing rules apply), watch it
   fail for the right reason, then make ONE fix at the root. Done when: the test fails before and passes
   after, and the wider suite is still green. No bundled refactor.
10. **Make it hard to recur.** Where bad data crossed several layers, add a check at the layers that matter;
    where a test waited on a sleep, wait on the condition. Done when: a bypass of the first guard is caught
    by the next. Detail: `references/defense-and-waiting.md`.
11. **Verify with fresh output.** Rerun the original reproduction and the affected suites; read the result,
    do not recall it. Done when: the original symptom is gone and nothing new failed (rule:failure-response
    step 3).
12. **Close out.** Record the cause and the fix where the project keeps lessons (rule:snag-response). For a
    live incident also write the postmortem. Done when: a reader who was not there can see cause, fix and
    prevention.

## Stop rules

- **Two failed attempts:** stop trying fixes; go back to step 5 and dump more state (the kit's number).
- **Three failed fixes, or each fix exposes a new problem elsewhere:** the design may be wrong. Stop and take
  it to the owner as a re-plan (rule:re-plan-on-failure), not a fourth patch.
- **Cannot observe the bug:** instrument first (on-screen readout, log), strip it after.
- **Cause outside your control** (vendor, platform, network): after the work above, handle it (retry with a
  limit, timeout, clear error, logging) and say what was ruled out. Why: most "no cause" verdicts are
  unfinished investigations, so show the work.

## Red flags

"Quick fix now, find out later." "Just try X." "Change several things and rerun." "I will skip the test and
check by hand." "It is probably X." "One more try" after two misses. Fixes proposed before any trace. Any of
these -> back to step 2. Why: each is a guess dressed as progress.

## Production incident

When users are affected now, mitigate first, diagnose second. Roles, severity, update cadence and the
postmortem shape are in `references/incident-response.md`. Posting a status, paging someone or messaging
users is an outward act: name it and wait for the owner's yes (rule:outward-acts). Why: stopping harm comes
before understanding it, but it still needs the owner's say.

## Gotchas

- A step that fails in about one second is a script error until its log says otherwise.
- Search the roadmap, parking lot and lessons file for the symptom before diving in.
- Test pollution (a file or state appears during a run, source unknown): bisect the tests one at a time.
- A harness can be the broken part: run a known-good and a known-bad control (rule:instruments-and-evals).
