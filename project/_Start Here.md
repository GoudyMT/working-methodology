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
| **2** | [`AGENTS.md`](AGENTS.md) + [`standards/INDEX.md`](standards/INDEX.md) | **HOW we work.** Methodology, code / security / test standards, design locks, compact hygiene. **Non-negotiable.** |
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

**Collaborative design locks (non-negotiable):** work proceeds **one issue at a time** with the owner's explicit lock before the next. "Complete the plan" / "finish all todos" never overrides that. Full detail: rule:collaborative-design-locks.

**Branch-first (non-negotiable):** feature work belongs on `<type>/<name>`, not `main`. Confirm the branch before the first edit to a tracked file; if on `main`, branch first. Gitignored vault `.md` is exempt. Full rule: rule:branching -> Branch-First Discipline.

---

## How We Work

Full rules: [`AGENTS.md`](AGENTS.md). Tests come first, watched failing.

---

## Quick-Reference Architecture

<!-- PROJECT ADAPTER: 5-10 one-line load-bearing decisions, each with its ADR link. Keep them pointers, not restatements. -->

- **<Decision>** - <one line> -> <ADR link>
- **Domain hard boundaries:** <fill in, from rule:project-adapter A2>

---

## Project Structure

<The top folders and what each holds, or a pointer to the README's tree. The tracking files sit at the root; history moves to `_Archive/`, never deleted.>

---

## Recovery Protocol (If You Lose Context Mid-Session)

rule:recovery-protocol: the start reads, then the first OPEN issue; if it is unclear which issue is open, one clarification question to the owner. Never recreate prior decisions from memory.

---

## Templates

[`_Templates/`](_Templates/) holds one per job: the session log entry, the ADR (MADR), the component spec and its security checklist (before a component is marked complete), and the PR body.

---

## What This File Is Not

- Not the design - read the spec.
- Not the methodology - read `AGENTS.md` and the modules it lists.
- Not the state - read `_Working Memory.md`.
