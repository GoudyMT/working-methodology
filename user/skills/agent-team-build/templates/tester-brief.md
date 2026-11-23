# Tester brief - <unit id>: <title>

Plan: <path to the plan file>
Unit: <unit id>
Role: tester
Worktree: <absolute path of your own worktree>

You write ONE unit's failing tests, and nothing else. Everything you need is below; you have no other context.
The lead can make this brief from the plan row: `node {{CLAUDE_HOME}}/kit-tools/plan-check.mjs <plan.md> --brief <unit>
--role tester`.

## Project rules (one source - read it, never a pasted copy)

Before anything else, read the "Rules every brief carries" item of rule:agent-team-adapter in full, to its last
line, with the Read tool: `<project folder>/standards/INDEX.md` names its file. A project still on one standards file keeps
it in `<project folder>/_Working Standards.md`. Those rules bind you, and their last line
says how every message you send opens (rule:agent-canary). If you cannot read it, stop and report that.

## Step 1 - lock your files first

Do this before you read the unit or write any test. From the repo root, run:

`node {{CLAUDE_HOME}}/kit-tools/unit-lock.mjs --tester --files <test file 1>,<test file 2>`

The lock lists the test files you may touch. Your edit fence then blocks every other file. The lead also writes this
lock into your worktree right after your spawn. If an edit is refused for no lock, wait a minute and try again; if it
stays refused, stop and report it.

## Setup

- **Base commit:** `<full hash>` - confirm HEAD equals it; if not, reset YOUR worktree to the lane sha and say so.
- **Setup commands:** <shell prefix; dependency install>
- **Scratch files:** put them outside the repo, in the scratchpad folder: `<scratchpad path>`. Never write a scratch
  file inside the repo or the main checkout.

## The unit

- **Goal (what the user gets):** <one line>
- **Test files you may write:** <exact list>
- **Read first:** <files, tests and docs, each with why>
- **Tests to write, and the failure each must show:** <each test, its input, its expected output>
- Write the tests, run them, and show each one red on an assertion, never on a syntax error, an import error or a
  crash. Never write product code. Never lower, skip or widen a test.

## Commands (exact)

- Run each command as a single command: no `&&`, no `;`, no pipe, no `cd`. Use absolute paths.
- Unit tests: <the exact command, e.g. `node --test <file>`>
- Commit format: <format and one example>. Commit your red tests locally; never push.

## Stop and ask

Stop-and-ask is the rule when the brief does not answer a choice, a test looks wrong, or a needed file is not on your
lock. Before you stop, make a wip commit (`chore: wip ...`) so your worktree is kept, then report the exact question.
Never guess.

## Report

Use the report format in your role instructions, as your final message. End it with a `RECORD:` line, then a role and
commit line, then one JSON line per open problem you found, then one notChecked line, as in this example:

```
RECORD:
{"role":"tester","commit":"<your head>"}
{"notChecked":"<what you did not get to, or nothing>"}
```
