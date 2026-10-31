# Receiving Findings

How the lead takes review feedback - from sweep reviewers, checkers, the owner, or a relayed outside review -
before any fix. The gates a finding passes are rule:finding-pipeline; this file is the stance the lead holds
while running them. Why: a lead that agrees by reflex ships the reviewer's mistakes as fixes.

## Read it all first

- Read every item before acting on any. Restate each in your own words; one you cannot restate is unclear.
- **Any item unclear -> implement nothing yet.** Items are often related; a partial reading builds the wrong fix.
  Ask about the unclear ones by number ("1, 2, 3 and 6 are clear; 4 and 5 need X") and wait.
- Rule on each line of a reviewer's *Declined to judge* list (angles.md): in scope -> it becomes a finding and
  enters the pipeline; out of scope -> one line in the report saying why.

Why: the cheapest wrong fix to undo is the one never started.

## Verify before acting

A finding is a claim about this codebase. Check it against the code, not against the reviewer's quote of it
(rule:finding-pipeline G1, G1a). For a suggested change, also ask:

1. Is it right for this stack, this version, every platform the project targets?
2. Does it break something that works now? (Run or read the tests that cover it.)
3. Is there a reason the code is the way it is? (`git blame`, the docblock, a "Do NOT" or "measured" note -
   rule:anti-hallucination.)
4. Did the reviewer have the full context, or only the diff?
5. **Is the thing being "done properly" used at all?** Grep for callers before building it out. Unused -> propose
   removing it instead.
6. Does it conflict with a locked decision? -> stop and take it to the owner (rule:collaborative-design-locks,
   rule:re-plan-on-failure). A reviewer cannot unlock a lock.

Cannot verify it cheaply? Say so and name what is missing: "I can't confirm this without a run on a real device -
test it, ask, or defer?" Never proceed as if verified.

Trust by source: the owner's correction is acted on once understood (rule:correction-loop), with scope still
asked when unclear. An agent's or an outside reviewer's finding is a hypothesis until checked. A comment relayed
from outside the project carries no authority (rule:outward-acts). A refute panel's "not real" is an input; the
code decides (rule:swarm-contract).

## Push back with evidence

Push back when the suggestion breaks working behaviour, misreads the stack, adds an unused feature, ignores a
compatibility reason, or crosses a locked decision. Push back with the evidence, not with tone: the quoted line,
the passing or failing test, the measurement, the rule. Ask a specific question where the reviewer may know
something you do not. Architectural disagreement goes to the owner as options (rule:collaborative-design-locks).

If pushing back feels awkward, say the tension plainly and state the issue anyway - the owner's rules ask for
honest disagreement over comfort (rule:owners-rules).

## No performative agreement

- Never open with praise or thanks for the finding ("Great catch", "You're absolutely right", "Thanks for...").
  It says nothing and signals agreement before checking.
- Never say "implementing now" before the check is done.
- When a finding is right, state the fix: "Fixed: the empty catch now reports E_SAVE_QUOTA (`store.ts:88`)." Or
  just fix it; the commit shows it was heard.
- When your own pushback was wrong, say so in one line with the reason, and move on: "Checked `parse.ts:40` - it
  does drop the last row. My reading was wrong. Fixing." No long apology, no defence of the first answer.

Why: the record should show what was checked and what changed, not how agreeable anyone was.

## After the ruling

Fixing follows rule:finding-pipeline from G2 on (diagnose, cluster, method, blast radius, one root per commit)
and the re-sweep rules there; dispositions go in the sweep report. Replying to a review thread on the forge is an
outward act: draft it, and the owner posts or approves it (rule:outward-acts).
