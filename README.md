# Working Methodology Kit

One developer's way of building software with Claude Code, packaged so any new or existing project starts from
the latest version of it, and every improvement a project makes can flow back in.

It holds the rules (how decisions are made and locked, test-first, test integrity, reviews, security, git and
release discipline), the session system that keeps long AI-assisted work from drifting (tracking files, the
orientation protocol, pre-compact closeout), the agent-team build method, the skills, the tools, and the owner's
working style as memory.

## What is in it

| Folder / file | Installs to | What it is |
|---|---|---|
| `user/CLAUDE.md` | `~/.claude/CLAUDE.md` | Global rules for every project. `{{OWNER_NAME}}` and `{{OWNER_PROFILE}}` are filled at install. |
| `user/agents/` | `~/.claude/agents/` | Agent roles: builder, checker, orchestrator, scanner. |
| `user/skills/` | `~/.claude/skills/` | agent-team-build, teacher, teacher-sync, human-factor, methodology-kit. |
| `project/` | the project folder | `_Working Standards.md`, `_Start Here.md`, `_Loop Learnings.md`, `AGENTS.md`, `CLAUDE.md`, the four tracking files, `_Templates/`, `.claude/` tools and settings. |
| `memory/` | `~/.claude/projects/<project>/memory/` | The owner's working style as subject files, with `MEMORY.md` as the index. |
| `NEW-PROJECT.md` | - | Entry point for a project that starts from nothing. |
| `EXISTING-PROJECT.md` | - | Entry point for a project that already exists: orient, map, find gaps, then adopt. |
| `THIRD-PARTY.md` | - | The plugins and skills the kit uses, their makers and licenses, and how to restore them. |
| `vendor/` | - | A credited backup copy of each third-party plugin and skill, with `CREDITS.md`. |
| `scripts/kit.mjs` | - | The one tool: install, fold-back, bump, snapshot, restore, scrub. Tests in `tests/`. |
| `kit.config.json` | - | The owner's name (the one settings line) and the third-party backup list. |
| `owner-profile.md` | - | A few lines about the owner, placed into the global rules. |

Every rule says "the owner". The name lives only in `kit.config.json`.

## Use it

Needs Node 20 or later and git. From a Claude Code session, say "/methodology-kit new" or "/methodology-kit
existing" (after the first `install user`), or follow the entry-point files by hand.

```bash
node scripts/kit.mjs install user
```

```bash
node scripts/kit.mjs install project "<project folder>"
```

Add `--dry-run` to see what would change first. Add `--force` to replace files that differ from the kit; the
old copies are kept in a dated `kit-backups` folder next to the install record. Use it once, when a machine or
project adopts the kit for the first time, after reading the dry run.

## Update pipeline

Methods change. The kit is the single source, and changes move both ways:

**Kit -> projects.** Each install records the kit version and a hash of every file it wrote
(`~/.claude/kit-install.json`, `<project>/.kit/kit-version.json`). Running `install` again updates every file
the project left alone and skips, with a reason, every file it changed. A new project always starts from the
latest kit; an existing one catches up with one command.

**Project -> kit (fold-back).** When a project improves a rule, a skill or a memory:

1. `node scripts/kit.mjs fold-back project "<project folder>"` (or `fold-back user` for `~/.claude`). It sorts
   each file into fold back (changed in the project), update (changed in the kit), conflict (both), new (a file
   the kit has never seen, such as a fresh memory or skill) and missing, and writes a report with the diffs to
   `reports/`.
2. The owner picks what is general enough for the kit. Claude writes it in, generalized.
3. `node --test tests/` and `node scripts/kit.mjs scrub` must both pass.
4. `node scripts/kit.mjs bump minor "<what changed>"` raises `VERSION` and adds a `CHANGELOG.md` entry.
5. Commit, then push on the owner's go. Other projects pull it with `install project`.

Run a fold-back at the end of any session that changed the standards, and at the end of every project.

## Privacy

The repository is private. `scripts/kit.mjs scrub` checks every kit file for home-folder paths, non-ASCII
characters and the words in `scrub.local.json` (kept out of git, so the list itself never leaks). Before any
move to public, decide what to do with `kit.config.json` and `owner-profile.md`, which hold the owner's details
on purpose.
