# Start Here - <PROJECT NAME>

> You are picking up a solo + AI-augmented build structured for multi-session, multi-month work with context loss between sessions. Read the files below in order to work exactly as the project requires.

---

## What Is This Project?

<2-4 sentences: what the product is, who it is for, the problem it solves.>

1. **<Core capability 1>**
2. **<Core capability 2>**
3. **<Core capability 3>**

**Built by:** the owner, solo + AI-augmented.

**Why now:** <one line>

**Full vision and scope:** see `<path to master design spec>`

---

## Reading Order (Mandatory Before Working)

| Order | File | What You Learn |
|---|---|---|
| **1** | This file (`_Start Here.md`) | Orientation, reading order, working mode |
| **2** | [`_Working Standards.md`](_Working Standards.md) | **HOW we work.** Methodology, code / security / test standards, design locks, compact hygiene. **Non-negotiable.** |
| **3** | [`_Loop Learnings.md`](_Loop Learnings.md) | **OPEN LESSONS.** Lessons that must not recur (a repeat = regression). Small; read every session. |
| **4** | [`_Working Memory.md`](_Working Memory.md) | **WHAT the state is.** Dashboard: last session, current phase, resume point, session index. |
| **5** | [`_Active Plan.md`](_Active Plan.md) | **WHERE we are.** Current focus and the exact next action. |
| **6** | [`_Master Roadmap.md`](_Master Roadmap.md) | **THE FULL PLAN.** Status per item across versions. Scan; dive into the current version. |
| **7** | `<master design spec>` | **THE VISION.** Product, architecture, components, security, risks, open decisions. |
| **8** | Last entry in [`_Session Log.md`](_Session Log.md) | **WHERE WE STOPPED.** Completed work, decisions, flagged items. |
| **9** | The spec / ADR / plan named by the Resume Point | **THE WORK.** |

---

## Working Mode

Tell the owner which mode you are in:

| Mode | What You Do | What You Don't Do |
|---|---|---|
| **Plan** | Research, explore, propose options (A/B/C), ask questions | No code writes. No design decisions without the owner's approval. |
| **Implement** | Write code under Edit Discipline after the design is locked | No unlocked decisions; no outward acts (push, PR, merge, release). |
| **Review** | Cross-examine, find contradictions, audit consistency | No edits unless the owner asks. |

**Default mode is Plan.** Start in Plan until the owner says otherwise.

**Collaborative design locks (non-negotiable):** work proceeds **one issue at a time** with the owner's explicit lock before the next. "Complete the plan" / "finish all todos" never overrides that. Full detail: [`_Working Standards.md`](_Working Standards.md) "Collaborative Design Locks".

**Branch-first (non-negotiable):** feature work belongs on `<type>/<name>`, not `main`. Confirm the branch before the first edit to a tracked file; if on `main`, branch first. Gitignored vault `.md` is exempt. Full rule: [`_Working Standards.md`](_Working Standards.md) "Branching" -> Branch-First Discipline.

---

## How We Work (Summary - Full Detail in [`_Working Standards.md`](_Working Standards.md))

1. **One issue at a time.** A/B/C with pros / cons, validated against the spec and security standards, an honest recommendation; wait for the owner's lock.
2. **Structured options, not inline prose.** The owner picks, we lock, we move on.
3. **Research before deciding.** Study how shipped products do it; scan existing code for patterns to reuse.
4. **Code only after the design is locked,** under the visible Edit Discipline.
5. **Cross-examine everything** - overlaps, gaps, security, edge cases - before locking or merging.
6. **Honest feedback always.** Never guess. Have reasons for everything.
7. **Test-driven development.** Tests first, watched failing.
8. **Privacy and security as architecture,** not afterthought.

---

## Quick-Reference Architecture

<!-- PROJECT ADAPTER: 5-10 one-line load-bearing decisions, each with its ADR link. Keep them pointers, not restatements. -->

- **<Decision>** - <one line> -> <ADR link>
- **Domain hard boundaries:** <fill in, from `_Working Standards.md` Project Adapter A2>

---

## Project Structure

```
<project root>/
  _Start Here.md                  <- YOU ARE HERE
  _Working Standards.md           <- Read FIRST
  _Loop Learnings.md              <- Open lessons (a repeat = regression)
  _Working Memory.md              <- Project state dashboard
  _Active Plan.md                 <- Current focus + next action
  _Master Roadmap.md              <- Status across versions
  _Session Log.md                 <- Chronological history
  _Archive/                       <- Moved-out history (never deleted)
  _Templates/                     <- Templates for sessions, ADRs, components, PR bodies
  AGENTS.md                       <- Durable handoff for any AI tool
  CLAUDE.md                       <- Claude Code entry
  README.md                       <- Public-facing intro
  docs/
    <specs>/                      <- Master design spec
    <decisions>/                  <- ADRs
    <plans>/                      <- Implementation plans
    <sweeps>/                     <- Sweep reports
  <src>/                          <- Source code
  <tests>/                        <- E2E / integration tests
```

---

## Recovery Protocol (If You Lose Context Mid-Session)

1. Read `_Active Plan.md` - resolved decisions, open issues
2. Read `_Working Memory.md` - dashboard, resume point
3. Read `_Loop Learnings.md` - open lessons
4. Read the last `_Session Log.md` entry - where we stopped
5. Read the specific spec / ADR / plan referenced
6. Resume from the first OPEN issue

If unclear which issue is open: **one clarification question** to the owner before presenting options. Do NOT recreate prior decisions from memory.

---

## Templates

| Template | When to Use |
|---|---|
| [`_Templates/_Session Log Template.md`](_Templates/_Session Log Template.md) | New session log entries |
| [`_Templates/_Decision Record Template.md`](_Templates/_Decision Record Template.md) | New ADR (MADR format) |
| [`_Templates/_Component Spec Template.md`](_Templates/_Component Spec Template.md) | New component design doc |
| [`_Templates/_Component Security Checklist.md`](_Templates/_Component Security Checklist.md) | Before marking any component complete |
| [`_Templates/_PR Body Template.md`](_Templates/_PR Body Template.md) | Every PR description |

---

## What This File Is Not

- Not the design - read the spec.
- Not the methodology - read `_Working Standards.md`.
- Not the state - read `_Working Memory.md`.

This file is the **entry point**. It tells you what to read next.
