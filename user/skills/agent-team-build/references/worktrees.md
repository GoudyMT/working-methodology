# Worktrees: detect, create, set up, clean up

Load this when a step needs an isolated workspace beyond what the builder role's `isolation: worktree` already gives
(the lead setting one up by hand, a probe, a prong's own worktree, or a cleanup that went wrong).
`agent-team-build` already owns: builders start from the current branch (`baseRef: head`), the base commit is
confirmed, probes that write run in a scratch clone, finished worktrees are removed after integration. This file adds
the detection, placement, baseline and cleanup rules it lacks.

Why: an unchecked worktree step either nests isolation inside isolation, commits the worktree folder into the repo,
or destroys files that exist nowhere else.

## 1. Detect before you create

Run these read-only checks first:

```
git rev-parse --absolute-git-dir
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
```

- Git dir differs from the common dir, and the last command prints nothing: you are already in a linked worktree.
  Do not create another. Go to section 3.
- The last command prints a path: you are inside a submodule. Treat it as an ordinary checkout.
- Both equal: an ordinary checkout. Create a worktree only if the plan or the owner calls for it.
- Empty branch name: detached HEAD. A branch must be named before the work can be handed over (see
  `finishing-a-branch.md`).

Done when: you can say in one line which of the four states you are in.

## 2. Create

1. Use the harness's own worktree tool or flag first (`EnterWorktree`, `isolation: worktree`, a `--worktree` flag).
   It places, names and cleans up the folder itself. A raw `git worktree add` next to a native tool leaves state the
   harness cannot see.
2. Only with no native tool, place the folder in this order: the project's declared worktree folder; else an
   existing `.worktrees/` or `worktrees/` folder at the repo root (`.worktrees/` wins); else `.worktrees/`.
3. Before creating a folder inside the repo, prove it is ignored: `git check-ignore -q .worktrees`. If it is not,
   add the line to `.git/info/exclude` (a local file: no tracked change, no commit). Do not edit `.gitignore` for
   it: that changes the owner's tracked files and needs a commit.
4. Create from the base the plan names, not from whatever is checked out:
   `git worktree add <literal absolute path> -b <branch> <base commit>`. Branch names follow the project's naming
   rule (type-prefixed, plain words; no tool prefixes).
5. If creation fails with a permission error (a sandbox), say so and work in place. Do not retry with other flags.

Done when: `git -C <literal absolute path> rev-parse HEAD` prints the plan's base commit.

## 3. Set up and baseline

- Shell setup and the install command come from the project adapter's field 3 (rule:agent-team-adapter). Never
  guess an installer from the files in the folder. Gitignored files a worktree needs are listed in
  `.worktreeinclude`; never secrets unless a unit truly needs them.
- Run every command as `git -C <literal absolute path> ...` or with the project tool's own `--dir <path>` flag. Do
  not `cd` into the worktree: a tool run from the wrong folder writes its caches in the main checkout (a fixed class
  in `orchestrated.md`).
- Run the unit suite once before any edit. Failures on a clean base make every later failure ambiguous: report them
  and let the lead decide to proceed or investigate (rule:failure-response). Never start building on a red base
  unannounced.
- Report: the path, the base commit, the baseline counts (tests, failures).

Done when: the baseline run is recorded with real counts.

## 4. Clean up

- Remove only worktrees you created, or that sit in the project's worktree folder. A worktree the host or another
  prong owns is left alone, however stale it looks.
- Remove from outside the worktree, with a literal path: `git worktree remove <literal absolute path>`, then
  `git worktree prune`. Never build the path from a variable (a fixed class in `orchestrated.md`).
- If removal is refused because the folder holds modified or untracked files, those files exist nowhere else. List
  them (`git -C <path> status --porcelain -uall`) and ask the owner: commit them, move them, or delete them. Never
  add `--force` on your own initiative.
- A worktree whose branch has an open pull request stays until the work lands: review feedback is fixed there.
- Keep a worktree after an integration that failed its gate. It is the evidence.

Done when: `git worktree list` shows no folder you made, or says why one was kept.
