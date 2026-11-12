# Existing Project: Orient, Map, Then Adopt the Kit

Use this when the kit comes into a project that already has code, history and maybe its own rules. The first
pass is READ-ONLY. Nothing in the project changes until the owner has seen the state map and locked the plan.

## 1. Get the latest kit

```bash
git -C <kit folder> fetch --tags
git -C <kit folder> checkout <newest v tag>
node <kit folder>/scripts/kit.mjs install user
```

`git -C <kit folder> tag --sort=-v:refname` lists the newest tag first. Install runs only from a release: a kit
folder off its tag, or with changed files in what install copies or reads, is refused (a pull would move it
onto main, off every tag).

A Claude setup with its own config folder (`CLAUDE_CONFIG_DIR`, for example a second account) needs its own user
install: run the same command with `CLAUDE_CONFIG_DIR` set to that folder. The session-start check names the folder
it read.

**Is this repo shared?** A team, client or open-source repo owns its `CLAUDE.md`. Never hand-merge the kit into the
host's files. A tracked `CLAUDE.md` is taken as the host's: the install writes the kit's `CLAUDE.md` as a personal
`CLAUDE.local.md` (the host's file wins any conflict), records the host file as host-owned so no check flags it, and
keeps the kit's local files out of git. For an untracked one, run the install with `--overlay`. Point the kit's
rules at the host's rules instead of restating them.

## 2. Orient (read-only)

Read, with real tool calls, not from memory:

- the README, any docs folder, any existing CLAUDE.md / AGENTS.md / contributing guide;
- the git state: branch, `git log --oneline -30`, open branches, open PRs (`gh pr list`);
- the stack: package or build files, the CI workflows, the test setup;
- what runs: the test suite and the CI gate, run once, with the real output kept.

## 3. See what the kit would change

```bash
node <kit folder>/scripts/kit.mjs install project <project folder> --dry-run
```

A file the project already has is never overwritten; the dry run lists each one as "already exists and differs".

## 4. Write the State Map and Gap Report

One file for the owner, `docs/kit-adoption.md` (or the scratchpad if git tracks docs and the owner prefers):

1. **Where it stands:** what the project is, what works (proved by the gate run), what is in flight.
2. **What it already does well:** rules or tools the project has that the kit lacks. These are fold-back
   candidates for the kit.
3. **Gaps against the kit:** each with its effort (Small / Moderate / EXTENSIVE) and its value to a user.
   Check at least: tests and test-first, a CI gate that matches the local gate, security basics (secrets,
   dependency audit, the push guard), tracking files and the orientation protocol, decision records, a design
   spec, the human-factor check on its UI.
4. **Improvements:** ranked by what a user would notice, with a recommendation where to start.
5. **Risks:** anything found that could lose data or break the build.

Every claim carries its evidence: a file and line, a command and its output, or a label that says it was
inferred.

## 5. Adopt, one issue at a time

Present the plan as A/B/C choices and stop. On the owner's yes:

1. Run the install for real. New files land; existing ones stay. A project that keeps its own file where the kit ships
   a guard file (often its own `.githooks/pre-commit`) is held on every call until the owner checks that file and runs
   `install project <folder> --accept-host <file>` in a terminal; a session cannot accept it.
2. Merge each listed file by hand (never a host-owned file in a shared repo; see step 1): keep the project's specifics, add the kit's rules, and fill the adapters
   (see NEW-PROJECT.md step 4). The pre-compact closeout must carry the rule sort for the kit
   (rule:pre-compact-scan, step 5b), even when the project keeps its own standards.
3. Seed the tracking files from the state map. Set up the vault backup and the skill cases (NEW-PROJECT.md steps
   3b and 3c). If the project keeps its own `.claude/settings.json`, add the kit hook's SessionStart, UserPromptSubmit and
   PreCompact entries to it by hand (copy them from the kit's `project/.claude/settings.json`, putting the project's
   full path, with forward slashes, where they say `{{PROJECT_DIR}}`), so the kit check cannot be missed. The guards need no entry there: `install user` runs them from `~/.claude` (1.25.1). Turn on the git push guard (NEW-PROJECT.md step 2) and
   keep the kit local (NEW-PROJECT.md step 3; a project already pushed runs the first push check once anyway, to
   find kit or private files already in its history).
4. Run the gate again and show it green.

## 6. Fold back what the project taught

If step 4 found rules or tools better than the kit's, run `fold-back project <folder>` and follow the README's
update pipeline, so the next project starts with them.
