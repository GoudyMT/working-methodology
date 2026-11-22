# Builder brief - <unit id>: <title>

You are building ONE unit. Everything you need is below; you have no other context.

## Project rules (one source - read it, never a pasted copy)

Before anything else, read the "Rules every brief carries" item of rule:agent-team-adapter in full, to its last
line, with the Read tool: `<project folder>/standards/INDEX.md` names its file. A project still on one standards file keeps
it in `<project folder>/_Working Standards.md`. Those rules bind you, and their last line
says how every message you send opens (rule:agent-canary). If you cannot read it, stop and report that.

## Setup

- **Base commit:** `<full hash>` - confirm HEAD equals it; if not, reset YOUR worktree to it and say so.
- **Setup commands:** <shell prefix; dependency install>
- **Ports and environment for this unit:** <e.g. a browser-test port of its own>
- **Unit file list:** the lead writes `kit-unit-files.txt` with `unit-lock.mjs` once the red commit lands, from the
  "Files you may change" and "Files you may create" lines above. Your edit fence (rule:agent-role-table) then blocks
  any other file. Never change the list; a file missing from it is a stop.

## The unit

- **Goal (what the user gets):** <one line>
- **Files you may change:** <exact list>
- **Files you may create:** <exact list> | none
- **Read first:** <files, tests and docs, each with why>
- **Red tests (the tester's red commit <sha>; never edit them), and the failure each must show:** <...>
- If a test looks wrong, stop and report it; never work around a test.
- **Done when:** <observable conditions>; within this unit's size-budget share: <each budget and the bytes this
  unit may add> | no size budget touched

## Collision list (from the lead's repo-wide search)

<each test, caller, fixture or piece of copy the change can affect, and what to do with it>

## Commands (exact)

- Unit tests: <the covering tests, by lookup where the runner has a coverage map (the kit's: `node scripts/test-run.mjs
  --changed --pick` prints them; run the ones this unit changed with `node --test <file>`, as a `--changed` run is CI's);
  else the touched files' tests; CI runs the rest>
- Type-check: <...>
- Lint: <...>
- Commit format: <format and one example>

## Report

Use the report format in your role instructions, as your final message. End it with a `RECORD:` line, then a role and
commit line, then one JSON line per open problem you found (a real open problem only; its keys are "id", "severity",
"status", "where", "claim", "proof" and "fix"), then one notChecked line, as in this example:

```
RECORD:
{"role":"builder","commit":"<your head>"}
{"id":"<F1>","severity":"<high>","status":"<confirmed or plausible>","where":"<file:line>","claim":"<one line>","proof":"<the evidence>","fix":"<the fix>"}
{"notChecked":"<what you did not get to, or nothing>"}
```
