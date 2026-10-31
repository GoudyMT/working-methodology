# AGENTS - <PROJECT NAME> (AI & Collaborators)

> The project's entry point for every AI tool: the owner's non-negotiables, the read order, then the core rules and the index of rule modules. Written by the kit's build; a **durable handoff** when chat context resets or a tool reads only the repo root.

---

## Non-Negotiable

The core rules below this part are the full rules; these are the ones a tool reading only this file must not miss.

1. **One issue at a time, locked by the owner.** Bulk instructions ("complete all todos", "implement the plan") do NOT override that; advance the current open issue. Decisions the records already answer follow rule:delegated-decisions. Full rule: rule:collaborative-design-locks.

2. **Code writes gated by Edit Discipline** (rule:edit-discipline). Do not create or "complete" source files from inference alone.

3. **New chat / context limit:** read the Read Order below. Resume at the **first open issue**. Do not regenerate prior decisions from memory.

4. **Privacy and security ABOVE all else.** Every decision is evaluated against the project's data boundary and security baseline. See rule:security-standards and its Project Adapter.

5. **Tests never yield to implementation.** When a test fails, scrutinize the implementation FIRST; never weaken, relax or skip a test to make it pass. See rule:test-integrity.

6. **Outward acts are the owner's unless granted.** Push, PR, merge, release and public posts happen only on the owner's go or under a standing grant (rule:outward-acts). Asked to push or open a PR: say it is the owner's act and wait for an explicit yes, even when something else blocks it first.

---

## Read Order (Design and Implementation Work)

1. [`_Start Here.md`](_Start Here.md)
2. This file: the core rules below, and the module the moment needs (Rule Modules table at the end)
3. [`_Loop Learnings.md`](_Loop Learnings.md) - open lessons (a repeat = regression)
4. [`_Working Memory.md`](_Working Memory.md)
5. [`_Active Plan.md`](_Active Plan.md)
6. Last [`_Session Log.md`](_Session Log.md) entry
7. The specific spec / ADR / plan named by the Resume Point

---

## Hard Constraints

<!-- PROJECT ADAPTER A2/A4/A5: list each domain hard boundary as a "Never ..." line. Examples of the shape:
- **Never** propose features that send personal data to a server.
- **Never** propose ad-supported monetization.
- **Never** collect content from sources outside the allowed list.
-->

- **Never** ship API keys or secrets to the client. A backend proxies calls that need them.
- **Never** cross a domain hard boundary listed in rule:project-adapter (A2).
- <fill in>

---

## Tools / IDE Notes

- **Owner's shell:** <!-- PROJECT ADAPTER A23 --> `<shell + quirks>`.
- **Spec, ADRs, plans:** depth lives in their files. Tracking files (Master Roadmap, Working Memory, Active Plan, Session Log) hold SHORT summary + LINK only.

---

## Cross-Tool File Mapping (Memory-Bank Style Tools)

If your tool expects standard memory-bank files, here is where their content lives:

| Memory-bank file | This project's equivalent |
|---|---|
| `projectbrief.md` (foundation, core requirements) | The master design spec (`_Start Here.md` links it) |
| `productContext.md` (why this exists) | Design spec section 1 + any research folder |
| `activeContext.md` (current focus, next steps) | [`_Active Plan.md`](_Active Plan.md) + last [`_Session Log.md`](_Session Log.md) entry |
| `systemPatterns.md` (architecture, key decisions) | Design spec architecture section + ADRs |
| `techContext.md` (technologies, setup, constraints) | rule:project-adapter + ADRs |
| `progress.md` (status, what's left) | [`_Master Roadmap.md`](_Master Roadmap.md) + [`_Working Memory.md`](_Working Memory.md) |

---

## When Subagents Are Dispatched

- Subagents inherit session permissions; web tools may be denied. Verify per session.
- Subagents do NOT have chat history. Write self-contained briefs.
- Subagent claims need verification - direct-read files before locking decisions on an agent's report.
- No swarm without an approved Swarm Contract (rule:multi-agent-discipline).
- Build work inside a batch the owner approved follows the Agent-Team Build, in one of two modes (batch: the main session leads, mid-tier builders build in their own worktrees, a top-tier checker verifies each high-risk unit, the lead integrates and runs the full gate; orchestrated: the main session oversees an orchestrator per phase that runs its own team). See rule:agent-team-adapter.
