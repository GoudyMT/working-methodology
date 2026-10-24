---
name: review-and-sweeps
description: Read before any multi-agent review, pre-PR sweep, red-team, op-test or pre-merge device test.
metadata:
  type: feedback
---

**Pre-PR deep sweep before every substantive PR**: an adversarial vulnerability lens plus the standing dimensions (privacy, supply chain, legal, code security, scaling, goal alignment), with a report linked in the PR. It counts only if the agents actually ran this session. Trivial chores are exempt.

**The swarm contract - no fanout without one.** Before any fanout, show a table: one row per role, the distinct question only that role asks, its context, and what its finding looks like. Then wait for the go.
- **Count is derived from the risk regions**, never chosen.
- **Every role asks a question no other can.** No answer -> it is a clone; delete it.
- **Redundancy is not coverage.** An agent told to refute someone else's finding can only subtract.
- **Always spend one slot on the novel lens**: "what did everyone miss?" One agent with a new question beat over a hundred with a borrowed one.
- **Context is per role**, not boilerplate. Each role gets a token budget and a stop rule.
- **A mode signal ("cost is no object", "loop armed") authorizes the kind of work, never its size.** Scope harder, not less.
- **A refute panel informs; a reader rules.** Panels score wording, not truth. A finding confirmed by reading the code is real.
- **Record findings per role** so barren roles get cut.

**Cadence: two passes only.** One large sweep of the new work, then one short re-sweep scoped to whether the fixes broke anything. A third only for a major finding. Why: every review of real code finds more; past a point it buys ever smaller things.

**Red-team a safety-critical LLM prompt separately** from the code gates: misattribution, keyword-gate evasion, out-of-scope advice, delimiter forgery, the refusal boundary, plus a novel lens. Some fixes belong in code (structure that makes forgery impossible), not prose.

**Op-test before pushing a user-facing PR.** Use and attack the built app: the lead walks every flow (narrow and desktop widths, light and dark, console watched), plus break-it testers on distinct angles (input and date edges; tabs, reloads, offline; keyboard, screen reader, layout). It finds what code reviews miss. Small PRs may get the walkthrough only - say which.

**Live checklist board.** For a watched walk, keep a live checklist the owner follows: items ticked as they pass, notes from both sides, overall status, archive the last run before reseeding, end with a debrief.

**Test the real branch build on the real device before merge.** A desktop throttle does not stand in for a phone.

Related: [[findings-pipeline]], [[agent-teams]], [[quality-gates]].
