---
name: shell-and-tooling
description: Read before handing the owner a command on Windows, scripting git hooks or test runs there, or diagnosing a tool that fails quietly.
metadata:
  type: reference
---

**Windows PowerShell 5.1 dialect** for any command handed to the owner, whatever the code fence says:
- Chain with `; if ($?) { ... }`, never `&&`. Use `2>$null`, `$env:VAR='x'; cmd`; no head, tail, which, touch.
- Give one copy-paste line: no caret or backtick continuations.
- Multi-line or quote-heavy text to a native exe (gh, jq) goes through a file (`--body-file`); inline here-strings get split on embedded quotes.
- An empty-string argument to a native exe is dropped; omit the flag or pass an empty file.
- `2>&1` on a native exe turns stderr into errors and sets `$?` false even on exit 0, silently breaking an `if ($?)` chain.
- PS 5.1 misreads UTF-8; scan for non-ASCII with Node (`/[^\x00-\x7F]/`), not PowerShell or `grep -P`.
- Before a recursive delete near a directory junction, remove the junction with `cmd /c rmdir`; PS 5.1 can follow it into the real target.
- `git worktree remove` can fail on folders holding linked package directories; delete the folder, then `git worktree prune`.

**Git for Windows: a force-killed `sh.exe` from a shell-script shim reads as exit 0** to its parent, so a "stopped" hook can still land the commit. To stop a hung commit, stop the `git commit` tree or the test process, never an `sh.exe` in the chain.

**Hooks and test runs on a shared machine**
- Commit in the foreground with output streamed unfiltered to a log, one commit per call, never in parallel; a filter buffers everything and hides a hang.
- Before retrying a killed hook, confirm the half-state: status, log, stash list, index lock, leftover test processes.
- Do not run the full browser test suite right before a commit the hook will run anyway.
- Stop preview servers and leftover test browsers before committing.
- A native access-violation crash (0xC0000005) that fails a step in seconds is the machine: retry once alone; after about two identical crashes, stop and propose a restart. Report the retry; never count it as the pass on its own.
- A loaded machine times out import-heavy tests. Sample top CPU and wait for quiet; never raise a test limit to get a pass.
- Watch a re-run with a timer just above its clean time, not an open wait.
- Never queue a file-editing step behind a test run that might hang.

**When a CLI prints an empty error, read its log file**; the cause is often only there. Search the roadmap and parking lot for a symptom before diagnosing it fresh.

Related: [[quality-gates]], [[remote-and-outward-actions]].
