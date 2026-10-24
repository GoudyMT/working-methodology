---
name: code-and-comment-style
description: Read before writing source code, code comments, or removing code.
metadata:
  type: feedback
---

- **Self-contained comments.** A comment must make sense to a reader with only the code. Cut internal references: plan or phase codes, decision-record numbers, spec section numbers, lesson ids, session numbers, "per task N", history narration, and anything that restates the code. Keep the non-obvious why, gotchas and security reasons, briefly. Why: a cycle label adds nothing for a fresh reader and makes a model stop to decode it; traceability lives in git and the docs.
- **Describe the mechanism, not the cycle.**
- **First occurrence gets the full why; repeats get one line; obvious code gets none.**
- **ASCII-only source.** Build special characters from char codes or escapes (`String.fromCharCode(0xfffd)`, `\uXXXX`); never paste literal control or replacement characters. Use `->` and ` - `, never unicode arrows or em dashes, in every file type.
- **Comment out, prove, then delete.** Commenting out suspected-dead code and proving nothing breaks is a good bloat check; once proven, delete it in the same piece of work. Only a clearly marked placeholder or a `TODO: <what> - <why not yet>` may stay. Git keeps the old text; name the commit to recover it.
- **Reference material moves to docs**, not into code comments. If a comment holds the only copy of something useful, move it first, then delete.
- **Prefer literal regexes.** Locate a value in source by plain string search, then extract with a literal pattern; a regex built from a variable trips static analysis.
- **Match an existing pattern for the same job** before inventing a new one; grep for the invariant the codebase already enforces.
- **Do not reuse a display transform** in an anchoring, id or search path that uses a different normalization.

Related: [[git-and-pr-workflow]], [[quality-gates]], [[findings-pipeline]].
