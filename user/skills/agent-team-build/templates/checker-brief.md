# Checker brief - <unit id>: <title>

## Project rules (one source - read it, never a pasted copy)

Before anything else, read the "Rules every brief carries" item of rule:agent-team-adapter in full, to its last
line, with the Read tool: `<project folder>/standards/INDEX.md` names its file. A project still on one standards file keeps
it in `<project folder>/_Working Standards.md`. Those rules bind you, and their last line
says how every message you send opens (rule:agent-canary). If you cannot read it, stop and report that.

## The goal and the plan unit

- **Goal the user set:** <one line>
- **The unit:** <the plan row: files, tests, done-condition>
- **Collision list:** <exactly as given to the builder>

## The work to check

- **Builder's worktree:** `<path>`   **Branch:** `<name>`   **Base:** `<hash>`   **Head:** `<hash>`
- **Builder's report (verbatim):**

<paste the builder's final message>

## What you may run to confirm

- <unit tests> | <type-check> | <lint>, with the shell setup: <prefix>
- **Ports and environment for this check:** <its own, never a running builder's>
- **Standards to consult for this unit (read only these sections):** <file#section, ...>

## Return

Your verdict, in the format in your role instructions.

## Variant: the fix check (after the review)

One checker on the review's fix commits instead of one unit. Keep the rules block and "What you may run to confirm";
replace "The goal and the plan unit" and "The work to check" with:

- **The findings these fixes answer:** <each finding, verbatim, with its id>
- **The fix commits:** <each hash, and the finding it answers>
- **What each fix must preserve:** <per fix: the behaviour, test, contract or safety property that must still hold -
  why the code was the way it was>
- **Branch:** `<name>`   **Base (before the fixes):** `<hash>`   **Head:** `<hash>`

The verdict covers each fix: does it answer its finding, and does it keep what it must preserve?
