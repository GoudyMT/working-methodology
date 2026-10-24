---
name: autonomous-loop-mode
description: Read when the owner arms the keyword-gated TDD loop, or at the start of any substantive task to scope loop-worthiness.
metadata:
  type: feedback
---

**A keyword-gated autonomous TDD loop** for mechanical, plan-specified tasks: failing test -> confirm red for the right reason -> minimal code -> confirm green (whole suite plus hook) -> commit in the house format -> next task, narrating with real output. Push stays the owner's. Why: iterate faster without lowering the bar; trust widens only as the process proves out.

- **Off by default; every compact resets it to off.** Arm only on the exact keyword, after a clean orientation.
- **Eligible only when the test shape, code approach and commit message are all locked by the plan.** New files and visuals qualify only when pre-locked in a loop contract (path, why, reference per file; locked mockup per visual).
- **Scope loop-worthiness at the start of every substantive task** and tell the owner which slices are mechanical vs choices. Not looping is fine; forgetting to consider it is a miss. Never manufacture trivial work to loop.
- **Self-correct mechanics, escalate choices.** Fix alone (cap about two tries, log the lesson): anchor misses, typos, imports, a library API that differs from the guess (read the installed types). Escalate: naming, format or scope decisions; any test edit that lowers integrity; an off-contract file; non-converging attempts; anything needing the human eye.
- **Integrity, not immutability.** A test edit that raises coverage or realigns to a locked rename is allowed; weakening, relaxing, skipping or swallowing never is.
- **Stop on any question, unlocked decision, unexpected result, or end of the mechanical tasks.** Abort at once on any owner message.
- **Bracket every run**: a stated contract before, a bottom-line loop summary after (with a "Decided alone" line).
- **Visual checkpoint**: after at most three human-facing increments, halt and show what was built, what to expect, how it works, what is questionable. Resume only on the owner's OK.
- **Capture only behavior-changing lessons**; a repeat is a regression, flagged loudly. Graduate proven lessons to the standards.
- **A keyword authorizes the kind of work, never its size.** Scope and state the file list before acting.

Related: [[testing-discipline]], [[agent-teams]], [[session-and-context-hygiene]].
