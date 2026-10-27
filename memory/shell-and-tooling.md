---
name: shell-and-tooling
description: Read before handing the owner a command on Windows, scripting git hooks or test runs there, or diagnosing a tool that fails quietly - shell facts plus pointers.
metadata:
  type: reference
---

- Commands in the owner's shell dialect -> _Working Standards.md "Anti-Hallucination Discipline (Standing)"
- Committing on a shared machine -> _Working Standards.md "Pre-Commit Discipline"
- Crashes, loaded machines, timed re-runs -> _Working Standards.md "Test and Review Cadence"
- Empty CLI errors; known symptoms first -> _Working Standards.md "Failure Response Discipline (Triage Before Fixing)"

**Windows PowerShell 5.1 facts** (the dialect for commands handed to the owner, whatever the code fence says):
- Chain with `; if ($?) { ... }`, never `&&`. Use `2>$null`, `$env:VAR='x'; cmd`; no head, tail, which, touch.
- Give one copy-paste line: no caret or backtick continuations.
- Multi-line or quote-heavy text to a native exe (gh, jq) goes through a file (`--body-file`); inline here-strings get split on embedded quotes.
- An empty-string argument to a native exe is dropped; omit the flag or pass an empty file.
- `2>&1` on a native exe turns stderr into errors and sets `$?` false even on exit 0, silently breaking an `if ($?)` chain.
- PS 5.1 misreads UTF-8; scan for non-ASCII with Node (`/[^\x00-\x7F]/`), not PowerShell or `grep -P`.
- Before a recursive delete near a directory junction, remove the junction with `cmd /c rmdir`; PS 5.1 can follow it into the real target.
- `git worktree remove` can fail on folders holding linked package directories; delete the folder, then `git worktree prune`.

**Git for Windows: a force-killed `sh.exe` from a shell-script shim reads as exit 0** to its parent, so a "stopped" hook can still land the commit. To stop a hung commit, stop the `git commit` tree or the test process, never an `sh.exe` in the chain.

Related: [[quality-gates]], [[remote-and-outward-actions]].
