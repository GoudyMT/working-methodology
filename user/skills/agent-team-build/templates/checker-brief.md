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

Your verdict, in the format in your role instructions. End it with a `RECORD:` block of the same shape as the builder's:
a role and commit line (the head you read), then one JSON line per finding with the keys "id", "severity", "status",
"where", "claim", "proof" and "fix", then one notChecked line, as in this example:

```
RECORD:
{"role":"checker","commit":"<the builder's head you read>"}
{"id":"<F1>","severity":"<high>","status":"<confirmed or plausible>","where":"<file:line>","claim":"<one line>","proof":"<the evidence>","fix":"<the fix>"}
{"notChecked":"<what you did not get to, or nothing>"}
```
