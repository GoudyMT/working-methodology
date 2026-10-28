# Builder brief - <unit id>: <title>

You are building ONE unit. Everything you need is below; you have no other context.

## Project rules (one source - read it, never a pasted copy)

Before anything else, read the "Rules every brief carries" item of rule:agent-team-adapter in full, with the
Read tool: `<project folder>/standards/INDEX.md` names its file. A project still on one standards file keeps
it in `<project folder>/_Working Standards.md`. Those rules bind you. If you cannot read it, stop and report that.

## Setup

- **Base commit:** `<full hash>` - confirm HEAD equals it; if not, reset YOUR worktree to it and say so.
- **Setup commands:** <shell prefix; dependency install>
- **Ports and environment for this unit:** <e.g. a browser-test port of its own>
- **Unit file list:** before your first edit, write every path from "Files you may change" and "Files you may
  create", one per line relative to your worktree, to the file that `git rev-parse --path-format=absolute
  --git-path kit-unit-files.txt` names (use the shell: it sits in git's folder, outside your worktree). Your edit
  fence (rule:agent-role-table) then blocks any other file. Never change the list; a file missing from it is a stop.

## The unit

- **Goal (what the user gets):** <one line>
- **Files you may change:** <exact list>
- **Files you may create:** <exact list> | none
- **Read first:** <files, tests and docs, each with why>
- **Tests to write first, and the failure each must show:** <...>
- **Done when:** <observable conditions>; within this unit's size-budget share: <each budget and the bytes this
  unit may add> | no size budget touched

## Collision list (from the lead's repo-wide search)

<each test, caller, fixture or piece of copy the change can affect, and what to do with it>

## Commands (exact)

- Unit tests: <...>
- Type-check: <...>
- Lint: <...>
- Commit format: <format and one example>

## Report

Use the report format in your role instructions, as your final message.
