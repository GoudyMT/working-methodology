---
name: session-and-context-hygiene
description: Read at session start, after a compact, before a compact, and when keeping tracking files and plans current - pointers into the standards.
metadata:
  type: feedback
---

The hygiene rules live in the standards; this file points to them.

- Tracking files, one job each -> rule:tracking-file-functions
- The plan file is the progress record -> rule:tracking-file-functions
- Lean ledgers and file caps -> rule:tracking-file-size-caps
- Fresh-read orientation after a compact -> rule:post-compact-orientation
- Compact after each large step -> rule:session-workflow
- The pre-compact closeout -> rule:compact-ritual
- Temp files and the rule sort -> rule:pre-compact-scan
- Ask instead of assuming -> rule:owners-rules
- Corrections codified the same session -> rule:correction-loop

Related: [[autonomous-loop-mode]], [[verification-and-evidence]].
