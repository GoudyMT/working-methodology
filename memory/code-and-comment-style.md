---
name: code-and-comment-style
description: Read before writing source code, code comments, or removing code - pointers into the standards.
metadata:
  type: feedback
---

The code rules live in the standards (and the global standards they extend); this file points to them.

- Self-contained comments, no cycle labels -> rule:code-standards
- Comment depth, docstrings, constants -> rule:code-standards
- Comment labels reworded to the mechanism -> rule:pre-compact-scan
- ASCII only, special characters at run time -> rule:code-standards
- Comment out, prove, then delete -> rule:code-standards
- Literal regexes, existing patterns, display transforms -> rule:code-standards

Related: [[git-and-pr-workflow]], [[quality-gates]], [[findings-pipeline]].
