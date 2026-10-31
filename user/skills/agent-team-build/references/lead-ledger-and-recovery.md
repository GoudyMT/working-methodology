# The lead's ledger, pre-flight scan and report statuses

Load this when a batch has more than a few units, when the lead's context may be compacted or replaced mid-run, or
when a builder's report comes back with a status other than plain done.
`agent-team-build` already owns: the plan's `## Progress` block as the progress record, the canary pick-up for
agents, the Report format in the builder role, and the 2-FIX-round limit. This file adds a recovery map for the lead
itself, a plan scan before dispatch, and what to do with each kind of report.

Why: a lead that loses its place after a compaction can re-dispatch whole finished units, the most expensive failure
seen in practice; and a plan whose units contradict each other costs a build to discover.

## 1. The ledger (recovery after context loss)

- Keep one ledger file per plan, outside the repo (scratchpad) or in a git-ignored folder. Its first line names the
  plan file. A ledger whose first line names a different plan is not yours: leave it and start your own.
- One line per event: unit started (builder, base commit), report received (status, head hash), check verdict, fix
  round (round number, findings addressed and open, commit range), unit complete (commit range), and every decision
  (`Decided alone`: what, why, what it costs if wrong).
- The commits it names exist in git even when your memory of making them is gone. After a compaction, trust the
  ledger and `git log` over recollection. Resume at the first unit with no "complete" line. A unit whose last line is
  a fix round is mid-loop: resume at the next round.
- The ledger is a working aid, not a second tracking file. The plan's `## Progress` stays the record the owner reads
  (rule:tracking-file-functions); copy the evidence there, never restate the ledger.
- Before any scratch folder is deleted, copy every decision line into the rundown's `Decided alone`.

Done when: after a simulated context loss, you can name the next unit to dispatch from the ledger and `git log` alone.

## 2. Pre-flight scan of the plan

Before the first dispatch, write a table, not a verdict. "The plan is consistent" without rows is a scan not run.

- One row for every pair of units that share a file or an interface: the two units, what one produces against what the
  other consumes, and what you found.
- One row for every unit: does its own text agree with itself (the tests it names against the code it names; the
  files it creates against the files it later touches)?
- Also flag anything the plan mandates that the project's rules treat as a defect (a test that asserts nothing, a
  duplicated logic block).

Rule on every finding before building, each against the locked spec or plan text that mandates it. A conflict with a
locked decision is the owner's to settle (rule:re-plan-on-failure); a plain mismatch is fixed in the plan. This
extends the collision list in flow step 1; it does not replace the repo-wide search.

Done when: the table is in the plan or ledger and every non-clean row has a ruling.

## 3. What to do with each report status

Ask builders to open their report with one status. Handle each one:

| Status | Lead's move |
|---|---|
| DONE | go to the check (high-risk unit) or to the break-check re-run (flow step 4) |
| DONE with concerns | read the concerns first. Correctness or scope: settle before any check. Observations (a file growing large): note them and continue |
| NEEDS CONTEXT | give the missing facts and resume the same builder |
| BLOCKED | decide by cause: missing context, resume with it; needs more reasoning, a stronger model on a fresh brief; unit too big, split it; plan wrong, correct the plan and tell the owner |

Never ignore an escalation and never send the same model back unchanged: if a builder says it is stuck, something in
the brief, the model or the unit size has to change. Escalating is never penalized; bad work is worse than none.
Keep the kit's limit: after 2 FIX rounds the lead finishes the unit or escalates.

## 4. Deferred findings

A minor finding is written down the moment it appears (ledger line `unit N: minor (deferred): <one line>`), and the
review wave is pointed at that list. A roll-up nobody reads is a silent discard. Minor items never extend a fix
loop. They go through the project's parking lot or finding pipeline like any other idea.

## 5. Briefing a checker without pre-judging it

Do not tell a checker to ignore an issue, treat it as acceptable, or cap its severity ("the plan chose this", "at most
minor"). If you believe a finding would be a false positive, let the checker raise it and adjudicate it on evidence.
A brief that pre-judges findings is usually sparing the lead a fix round. Hand the checker's attention lens as the
binding requirements copied verbatim from the plan or spec (exact values, formats, stated relations), not as opinions.
Give it the diff as one file in the scratchpad (commit list, stat, and `git diff -U10` for the range from the recorded
base) so it reads once instead of re-deriving the range with git. Always diff from the base you recorded before
the unit started, never from `HEAD~1`, which drops all but the last commit of a multi-commit unit.

Done when: the brief carries requirements, a base hash and a diff file, and contains no instruction to skip a finding.
