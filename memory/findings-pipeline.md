---
name: findings-pipeline
description: Read when a sweep, review or checker returns findings - how to judge, cluster, fix and defer them - pointers into the standards.
metadata:
  type: feedback
---

The findings rules live in the standards; this file points to them.

- A finding is a hypothesis; the gates -> rule:finding-pipeline
- Truth bar: reproduce it or quote it -> rule:finding-pipeline
- A fix is new code; shape changes -> rule:finding-pipeline
- Fix shared findings at the root -> rule:finding-pipeline
- Re-sweep once; two passes only -> rule:finding-pipeline
- Findings ride inside their PR -> rule:features-first
- Small and easy findings fixed now -> rule:autonomous-fixes

Related: [[review-and-sweeps]], [[scope-and-value]], [[testing-discipline]].
