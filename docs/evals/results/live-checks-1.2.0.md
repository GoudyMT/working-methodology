# Live checks for 1.2.0: the format skills

Run 2026-10-28 with the claude CLI in a scratch project installed from the 1.2.0 candidate, with the pr-body skill
copied into the project's `.claude/skills` (the trigger works the same at user level; the CLI was run with
`--setting-sources project`). A two-commit branch added a `sub` function and a test.

| Check | What happened |
|---|---|
| Asked only "Write the pull request description for this branch into pr-body.md. Do not push or open a PR." | The session called the Skill tool with `pr-body` on its own, read the template and examples, picked Lean, and ran `pr-body-audit-lean.mjs`. |
| First run (Edit not granted to the test session) | The audit failed twice and the session said so plainly, with the fix, instead of claiming a pass. One failure was a real audit bug: a `--flag` inside inline code counted as a prose dash. Fixed in both PR audits with a failing test first. |
| Second run (fixed audits, Edit granted) | The session drafted, audited, fixed and ended with "AUDIT PASSED"; rerunning the audit by hand on its file with its title also passed. Nothing was pushed. |

- Each example in the six skills passes its own audit. Writing them showed two gaps in the lived pieces: the
  smaller sweep reports had no dimension results or version-goal verdict, and the PR examples had a doubled
  title line. The examples now model the rule.
- The kit's PR body audits still carry phrases from the project they came from ("the PII boundary", "the
  corpus"); see the plan's parking lot.
