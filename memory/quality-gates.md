---
name: quality-gates
description: Read before claiming "green", preparing a PR, or recommending a merge - pointers into the standards.
metadata:
  type: feedback
---

The gate rules live in the standards; this file points to them.

- Green means every CI workflow step -> rule:ci-gate
- Commands from the workflow; exit codes -> rule:ci-gate
- Audit reruns, build beside E2E, ports -> rule:ci-gate
- CI-only scanners and unfixable advisories -> rule:security-standards
- Config ships with the change needing it -> rule:failure-response
- One-second failures are script errors -> rule:failure-response
- Verify state you were told -> rule:anti-hallucination
- How often the gates run -> rule:test-and-review-cadence

Related: [[testing-discipline]], [[git-and-pr-workflow]], [[shell-and-tooling]].
