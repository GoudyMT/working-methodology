# AGENTS - <PROJECT NAME> (AI & Collaborators)

> Same policy as rule:collaborative-design-locks. Read that file for the full framework; this file is a **durable handoff** when chat context resets or a tool reads only the repo root.

---

## Non-Negotiable

1. **One issue at a time** for design and implementation: present context -> A/B/C options -> security / design impact -> recommendation -> **stop**. The owner must agree (or approve a blend) before "**Locked:**". **Exception:** a decision the project's records already answer (standards, locked spec / plan, precedent, measurement) is Claude's to make after the impact test (lose a function? break code? lose value? - any yes = stop), and is reported in a `Decided alone` section at the end of the workflow - see rule:delegated-decisions.

2. **Code writes gated by Edit Discipline** (rule:edit-discipline): (a) component design locked, (b) implementation approach reviewed, (c) four-step discipline (think -> minimize -> confirm requirements -> confirm method) passes visibly before the edit fires. Explicit owner approval still required for high-stakes changes. Do not create or "complete" source files from inference alone.

3. **"Complete all todos," "implement the plan," "don't stop until done," or bulk task instructions do NOT override (1) or (2).** Treat them as: advance the **current** open issue; ask if unclear which issue is open.

4. **Default mode: Plan for design.** Lock A/B/C with the owner before execution. Once locked, edits proceed under Edit Discipline; the owner can override with "type it yourself" any time.

5. **New chat / context limit:** read `_Start Here.md`, `_Working Standards.md`, `_Loop Learnings.md`, `_Working Memory.md`, `_Active Plan.md`, the last `_Session Log.md` entry. Resume at the **first open issue**. Do not regenerate prior decisions from memory.

6. **Handoff line the owner can paste:** `[Topic] Issue [N] only. Plan mode. No code writes. A/B/C then stop.`

7. **Privacy and security ABOVE all else.** Every decision is evaluated against the project's data boundary and security baseline. See rule:security-standards and its Project Adapter.

8. **Tests never yield to implementation.** When a test fails, scrutinize the implementation FIRST. NEVER weaken assertions, relax regexes, or `.skip()` tests to make them pass. Moving a test's LOOKUP location is allowed ONLY after verifying the implementation's output at the new location. See rule:test-integrity.

9. **Outward acts are the owner's.** Push, PR, merge, release and public posts happen only on the owner's go.

---

## Read Order (Design and Implementation Work)

1. [`_Start Here.md`](_Start Here.md)
2. [`_Working Standards.md`](_Working Standards.md)
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
- **Never** cross a domain hard boundary listed in `_Working Standards.md` Project Adapter (A2).
- <fill in>

---

## Tools / IDE Notes

- Keep this file synced with `_Working Standards.md` on policy changes.
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
| `techContext.md` (technologies, setup, constraints) | `_Working Standards.md` Project Adapter + ADRs |
| `progress.md` (status, what's left) | [`_Master Roadmap.md`](_Master Roadmap.md) + [`_Working Memory.md`](_Working Memory.md) |

---

## When Subagents Are Dispatched

- Subagents inherit session permissions; web tools may be denied. Verify per session.
- Subagents do NOT have chat history. Write self-contained briefs.
- Subagent claims need verification - direct-read files before locking decisions on an agent's report.
- No swarm without an approved Swarm Contract (rule:multi-agent-discipline).
- Build work inside a batch the owner approved follows the Agent-Team Build, in one of two modes (batch: the main session leads, mid-tier builders build in their own worktrees, a top-tier checker verifies each high-risk unit, the lead integrates and runs the full gate; orchestrated: the main session oversees an orchestrator per phase that runs its own team). See rule:agent-team-adapter.
