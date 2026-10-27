---
name: review-and-sweeps
description: Read before any multi-agent review, pre-PR sweep, red-team, op-test or pre-merge device test - pointers into the standards.
metadata:
  type: feedback
---

The review rules live in the standards; this file points to them.

- Pre-PR deep sweep before substantive PRs -> _Working Standards.md "Pre-PR Deep Sweep"
- Swarm contract: derived count, distinct questions -> _Working Standards.md "The Swarm Contract (NO swarm without one)"
- Mode signals set kind, not size -> _Working Standards.md "Multi-Agent Discipline"
- Two passes only -> _Working Standards.md "The Finding Pipeline (Sweep Finding -> Fix)"
- Red-team a safety-critical LLM prompt -> _Working Standards.md "Mid-Design Red-Team (Security Before Lock)"
- Op-test and the live checklist board -> _Working Standards.md "Pre-Push Op-Test"
- The real branch build on a device -> _Working Standards.md "Preview Test Before Merge"

Related: [[findings-pipeline]], [[agent-teams]], [[quality-gates]].
