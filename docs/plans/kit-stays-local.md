# Kit Stays Local + First Push Gate (release 1.4.0)

**Goal:** the kit always lives in the working folder, ready to use, and never reaches the remote repo unless the
owner tracks a file on purpose to show growth. Before the very first push to a remote, a strict check proves it:
everything the owner wants tracked is tracked, and nothing else from the kit, the never-list or a secret is in any
commit. The owner's design, 2026-10-29.

## Decided

- The owner: the kit is never committed by default; chosen files are tracked on purpose to show growth.
- The owner: a strict sweep before the first push only, with a checklist of want-tracked and never-tracked.
- Claude (delegated, reported): the exclude list goes in `.git/info/exclude` (local, never pushed, so the list itself
  stays private), not `.gitignore`. The install writes it as a marked block. "Commit everything" stays only as the
  owner's explicit choice for a private repo (`"kit": "tracked"`).
- Claude (delegated, reported): the first-push gate is a git pre-push hook check, so it holds for the owner's own
  terminal and any AI tool, not only Claude Code. It applies only while the remote has no branches.

## Design

- **`.kit/tracking.json`** (optional): `{ "kit": "local" | "tracked", "track": [globs], "never": [globs] }`.
  `track` lists the files the owner wants in the repo (growth files from the kit are force-added with `git add -f`);
  `never` lists extra paths that must never be committed (school material, private notes).
- **Install** (`kit.mjs install project`): in a git folder, writes a `# kit:begin` / `# kit:end` block in
  `<git dir>/info/exclude` with every installed kit path plus `/.kit/` and `/.claude/worktrees/`. A reinstall
  replaces the block; the owner's own lines stay. `"kit": "tracked"` removes the block.
- **`.claude/first-push-check.mjs`** (project): the checklist. Fails on any of: a kit path (not in `track`) in any
  commit; a `never` path in any commit; a secret-shaped file name or value in any commit (values never printed);
  a `track` glob with no tracked file; the exclude block missing while the kit is local. Lists untracked files that
  are not ignored, as items to decide. On a pass it writes `<git dir>/kit-first-push-ok` with the checked HEAD.
- **Pre-push hook:** while the remote has no branches (`refs/remotes/<remote>/` empty), every pushed commit must be
  the one the check passed; otherwise the push is blocked with the command to run.
- **Rule:** rule:kit-stays-local and rule:first-push-gate in the git-and-release module; the sweep tiers name the
  first push (the deep sweep plus the check). Setup step 3 of NEW-PROJECT and EXISTING-PROJECT states the goal.

## Progress

- [ ] Failing tests: exclude block (write, replace, keep owner lines, tracked mode, no git), clean `git status`
      after install, the check (pass + each fail), the hook (first push blocked/allowed, later push unchecked).
- [ ] Install block, check script, hook, rules, setup docs.
- [ ] Live run in a scratch repo; independent review and one short re-check; bump to 1.4.0; push and install on
      the owner's go.
