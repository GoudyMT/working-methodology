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

- **`.kit/tracking.json`**: `{ "kit": "local" | "tracked", "track": [...], "never": [...], "reviewedSecrets": [...] }`.
  `track` lists what the owner wants in the repo (growth files from the kit are force-added with `git add -f`);
  `never` lists paths that must never be committed; `reviewedSecrets` lists files whose secret-shaped lines the
  owner checked. Entries read like .gitignore lines: a name covers everything under it.
- **Install** (`kit.mjs install project`): in a git folder, writes a `# kit:begin` / `# kit:end` block in
  `<git dir>/info/exclude` with every installed kit path, `/.kit/`, `/.claude/worktrees/` and the never list. A
  reinstall replaces the block; the owner's own lines stay. `"kit": "tracked"` drops the kit lines. It sets
  `core.hooksPath` to the kit hooks unless another hook manager is set, and leaves a done mark when every root
  commit of HEAD is already on a remote (the project was pushed before the kit came).
- **Pre-commit hook** (every commit, any tool): `first-push-check.mjs --staged` blocks staging a kit file not in
  `track`, a never path, or a secret-shaped file or value.
- **`.claude/first-push-check.mjs`** (the first push): one pass over every commit a push can carry (branches, tags,
  remotes; merges included; not the stash). Fails on a kit, never or secret path or a secret value in any commit; an
  empty `track`, a `track` entry with no tracked file, a named `track` file that is ignored; a never file sitting
  unignored; the exclude block missing. Lists untracked files to decide. On a pass it records the cleared commit.
- **Pre-push hook:** until the cleared commit is on a remote branch (or every root commit pushed is already on a
  remote), only the cleared commit, its ancestors and its tags may go out.
- **Rule:** rule:kit-stays-local and rule:first-push-gate in the git-and-release module; the sweep tiers name the
  first push (the deep sweep plus the check). Setup step 3 of NEW-PROJECT and EXISTING-PROJECT states the goal.

## Progress

- [x] Failing tests: exclude block (write, replace, keep owner lines, tracked mode, no git), clean `git status`
      after install, the check (pass + each fail), the hook (first push blocked/allowed, later push unchecked).
- [x] Install block, check script, hook, rules, setup docs; plus a pre-commit check, hooks on at install, review fixes.
- [x] Live runs (docs/evals/results/live-checks-1.4.0.md); review and re-check, both fixed; recall 8/10; bump to 1.4.0.
- [ ] Push and install on
      the owner's go.
