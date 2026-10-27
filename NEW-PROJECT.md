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
pointed at this folder: the push guard, and the kit hook at session start and before each compact (`_Working
Standards.md` "Kit Standards" #1). It writes `.kit/kit-version.json`, the record that later updates and
fold-backs read.

Then install the third-party plugins the work needs: see [THIRD-PARTY.md](THIRD-PARTY.md).

## 3. Decide what git tracks (a choice for the owner)

- **A (default):** commit the code, keep the governance files local. Add `*.md` (with exceptions for README,
  LICENSE, docs that ship), `.claude/` and `.kit/` to `.gitignore`. Private notes never reach the remote.
- **B:** commit everything. Fine for a private repo that only the owner reads.

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
`.claude/skill-cases.local.json`, for example `{ "on": ["ui-ux", "feature-build", "debugging", "review"] }`.
The session-start hook then lists the skills for those cases every session.

## 4. Fill the project adapters

Every `<PROJECT ...>` placeholder and every `PROJECT ADAPTER` block gets a real value, one issue at a time:

- `_Start Here.md`: what the project is, who it serves, the reading order.
- `CLAUDE.md`: the project's hard rules. The general ones stay; add the domain boundaries (legal limits,
  data rules, content sources) the project must never cross.
- `_Working Standards.md`, "Project Adapter": the stack, the full gate command (what CI runs), size budgets,
  test devices, the deploy model, the branch and release conventions.
- `AGENTS.md`: the same hard rules for other AI tools.

## 5. Define the project before building

1. Write the master design spec (`docs/superpowers/specs/`), the first ADRs (`docs/decisions/`, from
   `_Templates/_Decision Record Template.md`), and a Success Charter for the first version.
2. Set up the gate first: tests, lint, type checks and CI, so "green" means something from day one.
3. Seed the tracking files: `_Working Memory.md` (session 1), `_Active Plan.md` (the first concrete action),
   `_Master Roadmap.md` (the versions as checkboxes), `_Session Log.md` (session 1).

## 6. Start working

Every session after this one starts with the Post-Compact Orientation Protocol in `_Working Standards.md`:
fresh reads of the reading order, a visible checklist, then the first action confirmed with the owner. Every
session ends with the pre-compact closeout, whose rule sort (scan step 5b) sends portable rule changes back to
the kit.

When the project's standards improve, fold them back into the kit (README, "Update pipeline").
