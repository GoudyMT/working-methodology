---
name: quality-gates
description: Read before claiming "green", preparing a PR, or recommending a merge - pointers into the standards.
metadata:
  type: feedback
---

The gate rules live in the standards; this file points to them.

- Green means every CI workflow step -> _Working Standards.md "CI Gate"
- Commands from the workflow; exit codes -> _Working Standards.md "CI Gate"
- Audit reruns, build beside E2E, ports -> _Working Standards.md "CI Gate"
- CI-only scanners and unfixable advisories -> _Working Standards.md "Security Standards"
- Config ships with the change needing it -> _Working Standards.md "Failure Response Discipline (Triage Before Fixing)"
- One-second failures are script errors -> _Working Standards.md "Failure Response Discipline (Triage Before Fixing)"
- Verify state you were told -> _Working Standards.md "Anti-Hallucination Discipline (Standing)"
- How often the gates run -> _Working Standards.md "Test and Review Cadence"

Related: [[testing-discipline]], [[git-and-pr-workflow]], [[shell-and-tooling]].
