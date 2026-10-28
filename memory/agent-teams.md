---
name: agent-teams
description: Read before dispatching builder, checker, scanner or orchestrator agents, or deciding whether to delegate at all - pointers into the standards.
metadata:
  type: feedback
---

The team rules live in the standards; this file points to them.

- Team roles, adapter fields, scoreboard -> rule:agent-team-adapter
- Briefs, worktrees, cherry-pick, FIX rounds -> rule:agent-team-adapter
- Briefs read the rules block, never paste -> rule:kit-standards
- Batch or orchestrated mode by size -> rule:test-and-review-cadence
- Model tiers, pinned versions, scanner re-checks -> rule:patterns-and-dispatch
- When to delegate, honest split economics -> rule:patterns-and-dispatch
- Team sweeps still reach the owner -> rule:swarm-contract
- No agent ever acts on the remote -> rule:outward-acts
- One session per prong; agents only when they pay off; the plan states why -> rule:patterns-and-dispatch

Related: [[review-and-sweeps]], [[autonomous-loop-mode]], [[remote-and-outward-actions]].
