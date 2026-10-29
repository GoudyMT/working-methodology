# New Project: Start From the Kit

Use this when a project starts from nothing (or from a fresh scaffold). Claude runs these steps with the owner;
the owner locks each choice. Nothing here pushes or publishes.

## 1. Get the latest kit

```bash
git -C <kit folder> pull
node <kit folder>/scripts/kit.mjs install user
```

The second command refreshes `~/.claude` (global rules, agent roles, skills). It never overwrites a file you
changed there; it lists it instead. If it lists one, run `fold-back user` (see the README) before you go on.

## 2. Install the project layer

```bash
node <kit folder>/scripts/kit.mjs install project <project folder>
```

This copies the standards, the four tracking files, `_Templates/`, the tools and `.claude/settings.json`, and
seeds the working-style memory into Claude Code's memory folder for this project. The settings wire three hooks
pointed at this folder: the push guard, and the kit hook at session start, on each message and before
each compact (rule:kit-standards #1). It writes `.kit/kit-version.json`, the record
that later updates and fold-backs read.

Then turn on the git push guard, so a push by any AI tool waits for the owner's go (rule:outward-acts):

```bash
git -C <project folder> config core.hooksPath .githooks
```

If the project already runs git hooks from another folder (husky, lefthook), add the check in
`.githooks/pre-push` to that pre-push hook instead.

Then install the third-party plugins the work needs: see [THIRD-PARTY.md](THIRD-PARTY.md).

## 3. Keep the kit local; decide what git tracks (rule:kit-stays-local)

The kit lives in this folder, ready to use, and never in the repo by default. The install already listed every
kit path in a marked block of `.git/info/exclude` (local, never pushed); `git status` shows only the project.
Run `git init` before the install, or run the install again after it, so the block is written.

1. Write `.kit/tracking.json` with the owner:
   ```json
   { "kit": "local", "track": ["src/**", "README.md"], "never": ["<course or client material>/**"] }
   ```
   `track` is every file the owner wants in the repo, kit files chosen to show growth included; `never` is
   every path that must never be committed (another party's material, private notes). Put `never` paths in
   `.gitignore` too, before the first commit.
2. Add each chosen kit file on purpose: `git add -f <file>`. Once tracked, git keeps tracking it.
3. Committing the whole kit (`"kit": "tracked"`, then install again) is the owner's explicit choice, for a
   private repo only.
4. Before the first push to a remote: the first push gate (rule:first-push-gate) - the deep sweep at the
   first-push tier and `node .claude/first-push-check.mjs`. The pre-push hook (step 2) holds the first push
   until the check passes for the commit being pushed.

## 3b. Set up the vault backup

The private notes (whatever git does not track) are backed up to their own private repository at every compact.
Pick a folder beside the project, for example `<project folder>-vault`, and write `.kit/vault.json`:

```json
{ "dir": "../<project name>-vault", "include": ["*.md"] }
```

`include` takes git pathspecs (`*.md`, `notes/`). Secret files (`.env*`, `.dev.vars`, keys, `secrets/`) are
never copied, whatever the list says. On the owner's go, make the private remote once
(`gh repo create <owner>/<project>-vault --private --source <vault folder>`); after that the hook commits locally
and each push waits for the owner's go.

## 3c. Turn on the skill cases

Read `.claude/kit/skill-cases.json` with the owner and record the cases this project needs in
`.claude/skill-cases.local.json`, for example `{ "on": ["ui-design", "ui-review", "feature-build", "debugging", "review"] }`.
The session-start hook then lists the skills for those cases every session.

## 4. Fill the project adapters

Every `<PROJECT ...>` placeholder and every `PROJECT ADAPTER` block gets a real value, one issue at a time:

- `_Start Here.md`: what the project is, who it serves, the reading order.
- `CLAUDE.md`: the project's hard rules. The general ones stay; add the domain boundaries (legal limits,
  data rules, content sources) the project must never cross.
- rule:project-adapter (`standards/project-adapter.md`): the stack, the full gate command (what CI runs), size budgets
  (ask the owner whether this project wants them at all; `none` turns rule:size-budgets off),
  test devices, the deploy model, the branch and release conventions.
- `AGENTS.md`: the same hard rules for other AI tools.

## 5. Define the project before building

1. Write the master design spec (`docs/superpowers/specs/`), the first ADRs (`docs/decisions/`, from
   `_Templates/_Decision Record Template.md`), and a Success Charter for the first version.
2. Set up the gate first: tests, lint, type checks and CI, so "green" means something from day one. The commit
   hook and the full gate start with `node .claude/load-guard.cjs`, and the hook's related-tests selection is
   proved by breaking one test on purpose (rule:test-and-review-cadence).
3. Seed the tracking files: `_Working Memory.md` (session 1), `_Active Plan.md` (the first concrete action),
   `_Master Roadmap.md` (the versions as checkboxes), `_Session Log.md` (session 1).

## 6. Start working

Every session after this one starts with the Post-Compact Orientation Protocol (rule:post-compact-orientation):
fresh reads of the reading order, a visible checklist, then the first action confirmed with the owner. Every
session ends with the pre-compact closeout, whose rule sort (scan step 5b) sends portable rule changes back to
the kit.

When the project's standards improve, fold them back into the kit (README, "Update pipeline").
