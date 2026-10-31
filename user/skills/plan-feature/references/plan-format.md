# The Plan File

Loaded by Step 6. Write for a builder who knows the language but has never seen this code or this design, and
who will make a sensible choice wherever the plan leaves one open. What they cannot know is what was decided:
which files, which names and signatures, which values the design pins, which tests prove each task. The plan
holds exactly those. For an agent-team batch, use the agent-team-build skill's batch-plan template; the rules
below still hold for its units.

## Scope check

If the design covers independent parts, write one plan per part; each plan ships working, tested software on
its own. Plan the whole cycle before branching (rule:session-workflow) so the work lands in one branch.

## Header (in this order)

```markdown
# <Feature> Plan

## Progress
- Current task: <N>
- Done (with evidence): <task - commit - the check's result>
- Next: <task>
- Branch: <name>
- Open questions: <none | list>

**Goal:** <one sentence: what it gives the user>
**Design:** <path to the approved design doc; the plan argues from it and executors read both>
**Approach:** <2-3 sentences>
**Stack:** <the key tools it uses>

## Global Constraints
<One line each, values copied exactly from the design or the adapter: Tier 0 boundaries, version floors,
size budgets, naming and copy rules. Every task's requirements include this section.>

## Review Focus
<Up to five inputs or conditions the design implies but no task's tests exercise, most likely to hurt a user
first: the input, and what a reasonable user expects. Each line then gets its test added to the task that
owns that code. An empty section means "checked, none found".>

## Execution approach
<Per phase: inline, an agent team (which mode), or separate sessions - with the reason, its source, and the
expected time and cost (rule:patterns-and-dispatch).>

## Sweep tier
<feature | fix | triage | ..., and the modifiers it hits (rule:sweep-tiers).>

## Parking Lot
<empty at the start; one line per out-of-scope idea (rule:parking-lot)>

## Execution Notes & Deviations
<empty at the start; rulings and drift markers land here (rule:sdd-triangle)>
```

The Progress block is the record a fresh session resumes from (rule:tracking-file-functions); tick a task only
against shown evidence and record the measurement, not just "done".

## Files first

Before the tasks, list every file created or changed and its one job. This is where the split is decided.
- One clear job per file; files that change together live together; split by job, not by layer.
- Smaller focused files beat large ones; but in existing code follow its patterns, and propose a split only
  for a file you are changing that has grown unwieldy.

## Task size

A task is the smallest unit with its own test cycle that a reviewer could reject while approving its
neighbour. Fold setup, config and docs into the task whose result needs them. Each task ends with something
testable on its own. Mark each task **must** or **stretch**; the stretch tasks are what you cut first if the
work runs long. One phase goal in one sentence; if it does not fit in one, the phase is unfocused.

## Task shape

```markdown
### Task N: <component>

**Files:** Create `path` | Modify `path:lines` | Test `path`
**Interfaces:**
- Consumes: <exact names and signatures from earlier tasks>
- Produces: <exact names, parameters and return types later tasks rely on>

- [ ] Write the failing test `<name>`: <its assertions, with the design's exact values> -> verify: runs red
      on an assertion, for the right reason
- [ ] Implement `<name(params): Return>` in `<path>` -> verify: `<command>` passes
- [ ] Run the task's suite -> verify: `<command>` exit 0
- [ ] Commit `<type: subject>` (rule:commit-message-format)
```

Every step names its check before it starts (rule:tracking-file-functions). A builder sees only its own task,
so the Interfaces block is how it learns its neighbours' names.

## What a step holds

A step is done when the builder can write exactly one reasonable thing from it - unambiguous, not complete:
- **A test step:** the test's name and its assertions, with the design's exact values, and the real use it
  guards (rule:test-value).
- **A code step:** the exact signature, the file, and the values the design pins. A body only for an
  algorithm the signature and tests do not determine, or for exact copy the design fixes.
- **A check step:** the command and the output that means it passed.
- **A reference to another task:** point to its Interfaces block; never repeat its code.

Two failures: lines that decide nothing ("handle edge cases", "add validation", "TBD", "tests for the
above", a name no task defines), and a plan longer than the code it describes, which has written the code
instead.

## Self-review (five checks, run by you, fixed inline)

1. **Design coverage:** every requirement and acceptance criterion points to a task; add a task for any gap.
2. **Step scan:** every step lets the builder write one reasonable thing; no step decides nothing; no step
   carries a body its signature and tests already settle.
3. **Name consistency:** names, signatures and types match across tasks (`clearLayers()` in Task 3 and
   `clearAllLayers()` in Task 7 is a bug).
4. **Review Focus:** each input class the design implies has a test in some task; the uncovered ones most
   likely to hurt go in Review Focus with their tests added.
5. **Proportion:** if code blocks are most of the plan, replace bodies with signatures, test names and
   assertions, and re-check each step is still unambiguous.

## Hand-off

Link the plan to the owner with: the execution approach you recommend and the one-sentence reason (how much
the tasks depend on each other's interfaces, how many there are, what a shipped mistake would cost), and
every hard-stop question the plan raises, in one list. The owner's approval is the start.
