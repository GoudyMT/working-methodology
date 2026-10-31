---
name: methodology-kit
description: Start a project from the owner's working methodology kit, orient an existing project against it, or fold a project's improved standards back into the kit. Use when the owner runs /methodology-kit, or says to start a new project with the kit, adopt the kit in a project, update a project to the latest standards, or fold back / sync the standards.
---

# Methodology Kit

The kit is the owner's working methodology as one versioned folder: global rules, agent roles, skills, project
standards, tracking-file skeletons, templates, tools and working-style memory. Every project starts from its
latest version, and every improvement a project makes can flow back into it.

**Find the kit:** `~/.claude/kit-install.json` holds `kitDir` (the folder) and `version`. If the file is missing,
ask the owner where the kit lives. Read the kit's `README.md` before acting.

Arguments: $ARGUMENTS

## Modes

- **`new`** - follow `<kitDir>/NEW-PROJECT.md` for the current folder.
- **`existing`** - follow `<kitDir>/EXISTING-PROJECT.md`. The first pass is read-only and ends with a State Map
  and Gap Report for the owner.
- **`snapshot`** - refresh the credited backups of third-party plugins and skills: `node <kitDir>/scripts/kit.mjs
  snapshot`, then review the diff in `vendor/` (read any new community skill) before the kit commit.
- **`update`** - pull the latest kit into this project: `node <kitDir>/scripts/kit.mjs install project .`
  Report what was created, updated and skipped; for each skipped file, show the kit's change and merge by hand
  only on the owner's go. Once a file carries the kit's changes, record it: `node <kitDir>/scripts/kit.mjs install
  project . --merged <file>,<file>`. A file that differs only by this project's own values (adapter rows, tracking
  files) is normal and does not block "Current".
- **`status`** - the version check, read-only: `node <kitDir>/scripts/kit.mjs status .` It compares the kit
  folder with GitHub, and ~/.claude and this project with the kit, file by file. Show its lines as they are;
  "Current:" is the all-clear, "Not current:" names what to run. It is the first troubleshooting step whenever
  anything in the kit misbehaves (rule:failure-response, step 0).
- **`report`** - write up a process or method gap in the kit (rule:kit-standards item 12): `node .claude/improvement-report.mjs
  new "<title>"`, fill every section with evidence, then `audit <file>` until PASS. Tell the owner the file path; they
  hand it to the kit as is. On the kit side, a received report goes in `reports/improvements/`, and the release
  that fixes it names its ID in the CHANGELOG.
- **`fold-back`** (default when the owner says the standards changed) - the update pipeline below.

## The update pipeline (fold-back)

1. Run `node <kitDir>/scripts/kit.mjs fold-back project <folder>` and, if the global rules or skills changed,
   `fold-back user`. Each writes a report in `<kitDir>/reports/` (gitignored).
2. Read the report. For each fold-back, conflict and new item, decide with the owner, one at a time, whether it
   is a general rule (it belongs in the kit) or a project detail (it stays). Present A/B/C and stop.
3. For each item the owner keeps: write it into the kit's own file, GENERALIZED - "the owner" for the name, no
   project names, paths, session numbers or private details; the rule plus one line of why. Put the owner's name
   back as `{{OWNER_NAME}}` where a rendered file had it. A rule goes into its module in `<kitDir>/rules/` (its one
   home; `node scripts/kit.mjs find <words>` picks the module), with an `{#id}` and tags; then run `node
   scripts/kit.mjs build`. The matching memory subject file gets a `rule:<id>` pointer line, never a copy.
4. Run the kit's checks: `node --test tests/kit.test.mjs` and `node scripts/kit.mjs scrub`. Both must pass. Before a version
   bump, do the merge-and-retire pass (rule:kit-standards #5); the tests enforce the size cap,
   a why in every rule section, and memory that points instead of repeating.
   A brand-new rule goes in as a trial: mark it `[trial]` in the CHANGELOG note and add a row to `TRIALS.md`
   ("Kit Standards" #7), unless the owner promotes it directly.
5. Bump: `node scripts/kit.mjs bump patch|minor|major "<what changed>"` - patch for wording, minor for a new or
   changed rule or skill, major for a change in how the kit installs.
6. Commit in the kit with a one-line `type: subject` message. Show the owner the commit and the push command;
   push only on the owner's explicit go.
7. Re-run `install project` in the source project so its record matches the kit, and tell the owner that other
   projects pick the change up with `update`.

## Rules

- Every project the kit sets up or adopts carries the rule sort in its pre-compact closeout (rule:pre-compact-scan,
  step 5b). When adopting a project that keeps its own standards, add the step there.
- Never overwrite a file the owner changed; the tool skips it, and so do you, unless the owner says so.
- Never push, publish or make the kit's repository public without the owner's explicit go.
- Nothing personal leaves the kit's private files (`kit.config.json`, `owner-profile.md`, `scrub.local.json`).
