# CLAUDE.md - Project-Level Instructions

> Project-level Claude Code memory. Auto-loaded when Claude Code opens this project directory. Project CLAUDE.md beats user CLAUDE.md beats auto memory for instructions specific to this project.

**Project:** <PROJECT NAME> - <one-line description>.

**Last Updated:** <YYYY-MM-DD> (<what changed>)

---

## Critical Hard Rules (Read First)

1. **Default mode: Plan for design.** Lock A/B/C decisions with the owner before execution. Decisions the project's records already answer are delegated to Claude - impact test first, then a `Decided alone` report at the end of the workflow (rule:delegated-decisions). Once locked, edits proceed under Edit Discipline. Explicit per-file approval still required for high-stakes changes per Edit Discipline criteria.
2. **One issue at a time.** Bulk instructions ("complete all todos") do NOT override per-issue locks.
3. **Privacy and security ABOVE all else.** <!-- PROJECT ADAPTER A4/A5: the data boundary and product red lines, e.g. "Personal data never leaves the device by default. No third-party trackers. No ads, ever." -->
4. **Domain hard boundaries:** <!-- PROJECT ADAPTER A2: the legal / licensing / product lines this project never crosses. Fill in or write "none beyond the general rules". -->
5. **Content and data sourcing:** <!-- PROJECT ADAPTER A2: what may be collected or used, from where, under what license. Fill in or "n/a". -->
6. **Security baseline:** <!-- PROJECT ADAPTER A3: e.g. OWASP ASVS Level 2 for all code. -->
7. **TDD discipline.** Tests written before / alongside implementation; watch each fail first.
8. **Edit Discipline gates all code writes.** Four-step checklist (think -> minimize -> confirm requirements -> confirm method) passes visibly before Edit / Write fires. Agents 1-3 only when genuine uncertainty exists. The owner can override with "type it yourself" any time.
9. **Tracking files = pointers, not restatements.** Each tracking file (Session Log / Working Memory / Master Roadmap / Active Plan) has ONE unique function. Content in a source-of-truth file (spec / ADR / plan / git log / code) is referenced via pointer, never restated.
10. **No proactive tracking-file updates after every small step.** Tracking files update at a real-value milestone, session end (the owner declares), or the owner's explicit request. Source-of-truth files update immediately on real work.
11. **Post-compact / new session = Post-Compact Orientation Protocol first.** Fresh `Read` calls on every file in the handoff's Reading Order BEFORE any source-of-truth edits or agent dispatch. Visible `[x]` checklist with a one-line confirmation per file. System reminders, compaction summaries and memory are NOT substitutes. "I just re-read" is forbidden unless the Read tool was actually called this session.
12. **Tests never yield to implementation.** When a test fails, scrutinize the implementation FIRST - dump what the code actually produces, compare to spec, then decide. NEVER weaken an assertion, relax a regex, accept "close enough", catch exceptions silently, or `.skip()` a test to make it pass. Moving a test's LOOKUP location is allowed only after verifying the implementation's output at the new location. **Test value:** every test guards a real use or a real failure, the way a person, caller or agent uses the code - no fluff to raise counts.
13. **Pre-PR Deep Sweep before any substantive PR.** No feature / sub-project PR opens or merges to `main` without a deep multi-agent sweep - an adversarial vulnerability swarm + the 6 Milestone-Sweep dimensions (incl. version-goal alignment) - under an approved Swarm Contract, with its report recorded. Scale to stakes (trivial chore / docs / one-line PRs exempt). Satisfied ONLY by the agents actually running this session + the report existing - NEVER by a self-review, a recalled prior sweep, or "it looks fine".
14. **Outward acts are the owner's.** Nothing is pushed, merged, released or published without the owner's knowledge and go.

---

## Mandatory Reading on Session Start

@_Start Here.md
@_Working Standards.md
@_Loop Learnings.md
@_Working Memory.md
@_Active Plan.md
@AGENTS.md

(The `@filename` syntax tells Claude Code to inline these files at session start.)

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
