---
name: review-and-sweeps
description: Read before any multi-agent review, pre-PR sweep, red-team, op-test or pre-merge device test - pointers into the standards.
metadata:
  type: feedback
---

The review rules live in the standards; this file points to them.

- Pre-PR deep sweep before substantive PRs -> rule:pre-pr-deep-sweep
- Swarm contract: derived count, distinct questions -> rule:swarm-contract
- Mode signals set kind, not size -> rule:multi-agent-discipline
- Two passes only -> rule:finding-pipeline
- Red-team a safety-critical LLM prompt -> rule:mid-design-red-team
- Op-test and the live checklist board -> rule:pre-push-op-test
- The real branch build on a device -> rule:preview-test

Related: [[findings-pipeline]], [[agent-teams]], [[quality-gates]].
