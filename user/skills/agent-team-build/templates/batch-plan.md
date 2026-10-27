# Batch plan - <feature> (<date>)

- **Goal (what the user gets):** <one line>
- **Base:** branch `<feature branch>` at `<full commit hash>`
- **Approved by the user:** <date> | pending
- **Cost estimate (dollars):** <each phase: its estimate and its pause line> | batch mode: <the whole run>

## Execution approach (approved with the plan)

| Phase | Approach (direct / agents and their roles / separate sessions) | Why, and the source | Expected time | Expected cost |
|---|---|---|---|---|
| | | | | |

Settled at approval too: the copy lines and the size-raise band, and one scheduled check-in per phase.

## Units

| Id | Title | Files (exact; mark new files) | Tests to write first, and the failure each must show | Done when | Runs | Built by |
|---|---|---|---|---|---|---|
| U1 | | | | | parallel / alone / after Ux | builder / lead |

- **Runs:** "parallel" only when the unit shares no file, port, server or fixture with another parallel unit.
- **Built by:** "lead" for a small or tightly coupled unit; a split costs more than it saves there.
- **Done when** names the unit's size-budget share (below), or "no size budget touched".

## Collision list (from a repo-wide search, never from memory)

| Unit | What changes | Search run (exact pattern) | Each hit, and how it is handled |
|---|---|---|---|

## Settled at plan time

- **Legal and source facts:** <each fact the work rests on | each official source, quoted, with its link | the
  reading the code keeps, and why> | none
- **Size budgets:** <each budget | the room left at the base, measured by <command> | each unit's share> | none
  touched
- **Claims checked on the base:** <each roadmap box or finding the plan acts on | `file:line` | still real / done /
  changed>

## Team

| Agent | Role | Model | One job | Why it earns its slot | Inputs | Output | Runs when | Estimate (dollars) |
|---|---|---|---|---|---|---|---|---|

- The count follows from the units, never the other way round. Batch mode: the lead is the main session.

## Hard-stop questions for the user (answered at approval, together)

- <question> - <options> - <recommendation>   (or "none")

## Already answered by the records (the lead acts, then reports)

- <decision> - <the standard, locked plan, precedent or measurement that answers it>

## Integration

- **Order:** <U1, U2, ...>
- **Full gate:** <the adapter's gate command>
- **Review:** <the project's pre-PR review>
- **Visual check with the user:** <what to look at> | none

## Progress (ticked with evidence)

- [ ] U1 - <commit> - <checker PASS, or the lead's re-run break check> - <the evidence>
