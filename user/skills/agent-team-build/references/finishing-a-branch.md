# Finishing a branch: the hand-over checklist

Load this when the lead has integrated the units and is about to run the final gate, or the owner asks "is it ready".
`agent-team-build` already owns the flow up to the review wave (flow steps 5 to 7). This file adds the checks around
the end of it. It stops at a hand-over: the lead never merges, pushes, opens the pull request or deletes a branch
(rule:outward-acts). Those are the owner's.

Why: a branch handed over with a stale gate, a guessed base or an orphaned worktree costs the owner a round trip, and
a destructive step taken early cannot be undone.

## 1. Verify on the tree you will hand over

- Run the project's full gate (the adapter's field 2, rule:agent-team-adapter) on the integrated branch itself. A
  run on an earlier tree proves only that tree. Any change since the last green run means a new run.
- A red gate stops the hand-over. Diagnose with data (rule:failure-response); do not list options yet.

Done when: the gate summary shows every CI step at exit 0, on the head commit you name.

## 2. Confirm the base

- The base is what the work forked from: the plan names it. If it is not written down, ask "this branch split
  from <best guess> - correct?" and wait. A diff reported against the wrong base misleads the owner.
- Record `git merge-base <base> HEAD` in the report.

Done when: base commit and head commit are both written in the rundown.

## 3. Detect the workspace state

Use the checks in `worktrees.md` section 1.

| State | What the hand-over says |
|---|---|
| Ordinary checkout, named branch | the branch name, base, head |
| Linked worktree, named branch | the same, plus the worktree path, kept in place |
| Detached HEAD | no branch exists yet; give the owner the exact command to name one (`git switch -c <name>`, run at the head). The lead runs it only if the owner said so |

## 4. Present the options, do not take them

Give the owner the real choices with exact commands in their shell dialect, then stop:

1. Push the branch and open the pull request (its body goes through the pr-body skill first).
2. Merge locally into the base (the owner runs it).
3. Keep it as is.

State a recommendation and why. Nothing in this list runs without a clear yes that names the act.
Throwing the work away is never offered unprompted. If the owner asks for it, list what is lost (the branch, every
commit with its hash, the worktree path), wait for the explicit word, then give the command for the owner to run.

Done when: the options and commands are in the rundown and the lead is waiting.

## 5. After the owner's go

- Worktree: keep it while a pull request is open. Remove it by `worktrees.md` section 4 after the work landed, or
  when the owner says so.
- Read live state before reporting an act as done: branch, remote, CI result. Report with proof (a URL, a SHA, a
  state read back). A rejected push means the remote moved: investigate. A forced push happens only on the owner's
  explicit request that names it.
- Copy every `Decided alone` entry from the run into the final rundown before any scratch folder is deleted. A
  decision that dies with its workspace was made in secret.

Done when: the rundown lists what was done with proof, and what is left for the owner.
