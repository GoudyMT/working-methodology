# CLAUDE.md - Project-Level Instructions

> Project-level Claude Code memory. Auto-loaded when Claude Code opens this project directory. Project CLAUDE.md beats user CLAUDE.md beats auto memory for instructions specific to this project.

**Project:** <PROJECT NAME> - <one-line description>.

**Last Updated:** <YYYY-MM-DD> (<what changed>)

---

## Critical Hard Rules (Read First)

AGENTS.md, imported below, holds the full rules, its Non-Negotiable list first. Each rule has one home:

1. Design locks with the owner; what the records answer is decided and reported -> rule:collaborative-design-locks, rule:delegated-decisions.
2. One issue at a time; bulk instructions never override a lock -> rule:collaborative-design-locks.
3. Privacy and security above all; the project's lines -> rule:security-standards, rule:project-adapter (A2 to A5).
4. Tests first, watched failing; tests never yield to implementation; every test guards a real use -> rule:tdd, rule:test-integrity, rule:test-value.
5. Edit Discipline gates every code write -> rule:edit-discipline.
6. Tracking files are pointers, updated at a milestone or session end -> rule:tracking-file-functions.
7. After a compact or in a new session: the Post-Compact Orientation Protocol first -> rule:post-compact-orientation.
8. A sweep at its tier before any PR, never self-asserted -> rule:sweep-tiers.
9. Outward acts are the owner's unless granted -> rule:outward-acts, rule:standing-grants.

A step's rules (a PR, a commit, a tag or release, an agent fan-out) load at the step: the task gate holds it until they are read.

---

## Mandatory Reading on Session Start

@AGENTS.md
@_Start\ Here.md
@_Loop\ Learnings.md
@_Working\ Memory.md
@_Active\ Plan.md

(`@file` inlines a file at session start; a space in its name needs a backslash, or the file never loads.)

Additionally read the last entry in [`_Session Log.md`](_Session Log.md) for the most recent state and resume point.

---

## File Hierarchy (Quick Reference)

<!-- PROJECT ADAPTER A22: adjust paths. -->

- **Master design spec:** `<docs/specs/>`
- **ADRs:** `<docs/decisions/>` with index at `000-decisions-index.md`
- **Implementation plans:** `<docs/plans/>`
- **Sweep reports:** `<docs/sweeps/>`
- **Templates:** [`_Templates/`](_Templates/)
- **Source code:** `<src/>`
- **Tests:** alongside source (`*.test.<ext>`) + E2E in `<tests/>`

---

## Cross-Tool Note

- **AGENTS.md** is the universal entry point read by other AI coding tools.
- This **CLAUDE.md** is the Claude-Code-specific entry; agents using other tools read AGENTS.md.

---

## Resume Point

See [`_Active Plan.md`](_Active Plan.md) for the current focus and the next concrete action.

---

## Honoring the Global CLAUDE.md

The owner's global CLAUDE.md (user level) defines global standards (communication style, coding conventions, naming, comment philosophy, decision-making, scope discipline). Those apply. This project CLAUDE.md adds project-specific rules on top. When global and project conflict, project wins for project-specific instructions; the global rules about honesty, never guessing and evidence-based work always apply.
