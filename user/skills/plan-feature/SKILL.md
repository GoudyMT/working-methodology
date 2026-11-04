---
name: plan-feature
description: Take an idea to an approved, executable plan and then build it. Read the records first, play back what was asked and found, get the owner's intent in their own words, explore the goal, offer 2-3 approaches with a recommendation, write a short design doc, then a step-by-step plan with a Progress block, then execute it. Use for a new feature, a behaviour change, or when the owner says plan, design, spec, "how should we build", or hands over an approved plan. Nothing is built before the design is approved.
---

# Plan a Feature

From an idea to an approved plan, then through the build. The kit owns the bar; this skill adds the order of
work, the done-condition of each step and the formats. Read these rules in full first, and never restate them:
rule:goal-before-mechanism, rule:collaborative-design-locks (the A/B/C shape), rule:delegated-decisions,
rule:success-charter, rule:session-workflow (plan the whole cycle before branching) and
rule:tracking-file-functions (the plan's `## Progress` block).

Why: what the owner wants is usually thinner in our heads than it feels; a cheap question and a short written
design cost less than one wrong build.

## When it applies

Size the work first and say the size in one plain line. The owner may override it.

| Size | The full description lives | Then |
|---|---|---|
| Quick, clear task (everything that matters is in the request) | the request | do it under rule:edit-discipline; this skill ends |
| Small change (one component, one flow, a few files) | a short design in chat | a short task list in chat, then build |
| Project (new surface, new data flow, several components, any Tier 0 touch) | a design doc file | a plan file, then build |

- If the work grows mid-way, stop, say so, and step up a size.
- If the request is really several independent projects, say so, agree an order with the owner, and run this
  skill once per project (rule:collaborative-design-locks: one issue at a time).
- If the owner says "just start": state each how-it-gets-made default (platform, library, file layout) in one
  line and build. Tier 0 and outward acts still stop (rule:delegated-decisions).

Why: a ceremony sized for a project wastes a quick task, and a quick-task habit wrecks a project.

## Step 1 - Read before you ask

Before the first question, read what the project already says: the tracking files' Resume Point, the design
spec sections the idea touches, the ADRs and plans for that area (locations: adapter A22), the parking lot and
roadmap lines that mention it, and the code the idea would change. Note every question those records answer;
each is decided under rule:delegated-decisions, not asked.

**Done when:** you can list the files you read and the questions they answered.

Why: a question the records already answer wastes the owner's time and shows you did not look.

## Step 2 - Play back, then hand the questions to the brainstorm skill

One message, in this order:
1. **What was asked**, in the owner's own words, one or two lines.
2. **What I found**: the facts from Step 1 that shape the work, most important first; offer the rest.
3. **What is still open**, sized: for small work and up, run the brainstorm skill. One or two questions go by
   chat, three or more by its sheet, and it keeps the owner's answers word for word in a record.

A guess the owner can correct often beats a question. Mark every guess as yours.

**Done when:** the brainstorm skill's stop rule is met, or the owner said the rest is yours to decide.

Why: every unasked question becomes a guess made without the owner, and intent kept in their words survives a compact.

## Step 3 - Explore the goal

Run rule:goal-before-mechanism: the goal in one line, the current state against it, every channel that could
reach it, and the cheap deciding measurement first. Probe the assumptions the idea rests on and name the
riskiest one plus the cheapest way to test it before anything is built. Detail, question craft and the
idea-generating techniques: the brainstorm skill's `references/question-craft.md`.

Play back as you go: once one part is understood (who it serves, how one piece behaves), describe it back in
200-300 words, mark your guesses, and ask what is wrong or missing.

**Done when:** the goal, the non-goals, the anti-goals (what would make it a failure even if it works) and the
riskiest assumption are written down and the owner has not corrected them.

Why: the named mechanism is often the nearest knob, not the right one.

## Step 4 - Offer 2-3 approaches and recommend

Think wide in private first (5-7 ideas, including one that removes something and one that does the opposite),
then drop the weak ones. Present the 2-3 real contenders in full, in the A/B/C shape of
rule:collaborative-design-locks, each with its effort and rules labels, its human-factor line when it touches
UI/UX (the human-factor skill), and its Dual-Horizon fit (rule:dual-horizon). List the rest of the space in one
line each so nothing is hidden. Then recommend one, with the reason, and stop.

A visual choice is decided from a wireframe in the real screens, never from prose
(rule:visual-design-collaboration). A design touching personal data, crypto, auth or an external surface gets
the red-team before the lock (rule:mid-design-red-team).

**Done when:** the owner has locked a pick, a blend or a revision.

Why: two or three worked options can be judged; ten cannot, and one is a decision already made for the owner.

## Step 5 - Write the design and get it approved

For differentiator or high-uncertainty work, write the Success Charter first (rule:success-charter). Then write
the design: in chat for a small change, as a doc file for a project. Keep it short; shorter for small changes.
Sections, the system-design checklist and the builder check:
[references/design-doc.md](references/design-doc.md).

Before handing a project's doc over, run the builder check (a fresh read-only agent reads it cold and lists only
the questions it would have to guess at). Sort its questions into answered-by-the-records, minor (settle and mark
as your call) and the owner's (asked the brainstorm skill's way: one message for one or two, its sheet from three up).

**The gate:** nothing is built until the owner approves the design - no product code, no scaffolding, no
installs, no new project. Reading and probing are fine. A throwaway spike the owner said yes to may be built; it
stays labelled throwaway, is never merged, and keeping any of it is a new request back through this gate,
rebuilt test-first (rule:tdd).

**Done when:** the owner has approved the design (in chat or the doc), and the doc's calls you made alone are
listed for them.

Why: "sounds good" covers only what the owner saw; an unwritten design is not approved.

## Step 6 - Write the plan

Write the plan file where adapter A22 says, from the approved design, so a builder with no chat history can
execute it. Format, task shape and the self-review:
[references/plan-format.md](references/plan-format.md). It carries the `## Progress` block, a check named on
every step (`<step> -> verify: <the check>`), the Execution approach (rule:patterns-and-dispatch), the sweep
tier (rule:sweep-tiers), the Review Focus list and an empty `## Parking Lot`.

Run the five-point self-review, fix inline, then link the plan to the owner with the execution approach you
recommend and why.

Each goal names the record answer it comes from (the brainstorm skill's record), or is marked as the planner's idea.

**Done when:** the self-review is clean and the owner has approved the plan.

Why: the plan is the set of decisions a builder cannot make alone; written down, they survive a compact.

## Step 7 - Execute the plan

Branch first (rule:branching). Then:
- **Agent team** (the plan's Execution approach says so): the agent-team-build skill; the owner's plan
  approval starts it.
- **Inline** (the lead builds): [references/executing.md](references/executing.md) - setup, the task loop, the
  completion contract, rulings, and the four stops.

Either way: TDD on every task (rule:tdd), the plan file is the progress record, decisions the plan does not
cover follow the Self-Correction Boundary in rule:loop-workflow-mode (self-correct mechanics, escalate
choices; it applies here too), and
every stopping point ends with the rundown and `Decided alone` (rule:delegated-decisions). After the last task:
the parking-lot triage (rule:parking-lot), the sweep at the plan's tier (the pre-pr-sweep skill), findings
through rule:finding-pipeline. Push, PR and merge are the owner's (rule:outward-acts).

**Done when:** every Progress line is ticked against shown evidence, the full gate is green
(rule:ci-gate), and the sweep report exists.

Why: an approved plan is approved scope, not a blank cheque; the gates are what make "done" true.

## Red flags

| Thought | Reality |
|---|---|
| "I'll ask a few questions to get going" | Read first. Ask only what the records cannot answer, through the brainstorm skill. |
| "Options save them effort" | Options steer. Get the owner describing first; options come at Step 4. |
| "I'll fill in sensible defaults" | Fine - say each one out loud. A default never heard cannot be rejected. |
| "They liked the idea, so the design is approved" | Approval covers what they saw. Write it, then ask. |
| "The spike works; I'll build on it" | Keeping it is a new request. Back through the gate, test-first. |
| "The plan is wrong here; I'll just do the right thing" | Do it only if it is mechanics, and record the ruling. A choice stops. |
