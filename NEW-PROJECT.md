# New Project: Start From the Kit

Use this when a project starts from nothing (or from a fresh scaffold). Claude runs these steps with the owner;
the owner locks each choice. Nothing here pushes or publishes.

## 1. Get the latest kit

```bash
git -C <kit folder> fetch --tags
git -C <kit folder> checkout <newest v tag>
node <kit folder>/scripts/kit.mjs install user
```

`git -C <kit folder> tag --sort=-v:refname` lists the newest tag first. Install runs only from a release: a kit
folder off its tag, or with changed files in what install copies or reads, is refused (a pull would move it
onto main, off every tag).

The install command refreshes `~/.claude` (global rules, agent roles, skills). It never overwrites a file you
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

The kit lives in this folder, ready to use, and never in the repo by default. Run `git init -b main` before the install
(or run the install again after it). The install lists every kit path in a marked block of `.git/info/exclude`
(local, never pushed) and turns on the kit's git hooks; `git status` then shows only the project.

1. Write `.kit/tracking.json` with the owner, then run the install again so the block picks up the never list:
   ```json
   { "kit": "local", "track": ["src/**", "README.md"], "never": ["<course or client material>"] }
   ```
   `track` is every file and folder the owner wants in the repo, kit files chosen to show growth included.
   `never` is every path that must never be committed (another party's material, private notes); the install
   keeps it in the private exclude block, not a `.gitignore` that would publish the names.
   `reviewedSecrets` (optional) lists files whose secret-shaped lines the owner checked and judged safe.
2. Add each chosen kit file on purpose: `git add -f <file>`. Once tracked, git keeps tracking it.
3. Every commit, from any tool, runs the commit check: staging a kit file not in `track`, a `never` path or a
   secret-shaped file or value is blocked.
4. Before the first push: the first push gate (rule:first-push-gate). Make the remote **private** first; run the
   deep sweep at the first-push tier and `node .claude/first-push-check.mjs`; push; check what landed on the
   host; only then make it public. The pre-push hook holds the first push until the check clears the commit.
   Once it is public and CI has a gate check, protect main (rule:first-push-gate, "Protect main").
5. Committing the whole kit (`"kit": "tracked"`, then install again) is the owner's explicit choice, for a
   private repo only.
6. On another computer, a fresh clone has no kit: run the install there, which writes the block and the hooks
   again (it sees the project was already pushed, so the first push gate is done).

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
- The PR-body audit's project facts (A16), in `.kit/pr-body.json`: the gates the project runs (each a row in the
  Standard body's gate table), the wording its dependency-audit row must keep, if any, and any line "Verified
  clean" must name beyond the secrets line. Without the file, the audit asks only for the dependency audit, lint and
  type check, and unit tests. Shipped folders for the version-bump check go in `.kit/version-bump.json`.
- `AGENTS.md`: the same hard rules for other AI tools.

## 5. Define the project before building

1. Run the brainstorm skill, then write the master design spec (`docs/superpowers/specs/`), the first ADRs (`docs/decisions/`, from
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
