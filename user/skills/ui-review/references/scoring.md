# Ranks, scores and the review file

Used in steps 6-8.

## Ranks (from rule:craft-floor)

P0 blocks the task; P1 fix before release (a user would ask for help); P2 annoying, has a workaround; P3 polish.

Ranking prompts:
- Rank by consequence, not by how easy the defect is to describe.
- A promise on screen the product cannot keep, on a page that asks for trust, money or personal data: P0.
- A WCAG A or AA failure that stops a keyboard or screen-reader user finishing the task: P0. One that slows them
  but they finish: P1. Accessibility is not its own rank; it carries an SC number beside its P rank.
- A failure with no visible error (the page renders, nothing responds): at least P1.
- Order the fix list by impact over effort inside each rank: a one-line fix that repairs the main path beats a
  redesign.

## The score rule (0-4 per heuristic)

Each of the ten heuristics gets a score derived from its worst confirmed finding, so the score is checkable and
two reviewers land on the same number:

| Score | Meaning |
|---|---|
| 4 | no finding against this heuristic |
| 3 | only P3 findings |
| 2 | at least one P2, no P1 or P0 |
| 1 | at least one P1, no P0 |
| 0 | at least one P0 |
| n/a | the heuristic does not apply to this surface (say why) |

Keep the ten scores side by side. Do not fold them into one number as the verdict: a total hides which
heuristic fell. A sum may be shown for the trend line only, with the n/a count beside it.

## Intermittent defects

Retest at least four times and list every attempt, the passes too:

```
try 1: 3.5 s, redirected       FAIL
try 2: 7.7 s, redirected       FAIL
try 3: no redirect in 12 s     PASS
try 4: no redirect in 12 s     PASS
```

The spread is the finding: it points at a race, not a fixed timer. Never report an intermittent as certain, and
never drop it.

## The review file

Path: `<sweep folder>/YYYY-MM-DD-<surface>-ui-review.md` (sweep folder: adapter A22). A screen reviewed inside a
sweep may instead be a section of that sweep's report.

```markdown
# UI review: <surface>

<fact-check line: N claims - X verified, Y corrected (listed), Z unverifiable>

- **Date:** YYYY-MM-DD   **Branch / commit:** <branch> @ <sha>
- **Surface job:** operate | read | persuade
- **Screens:** <list>   **Widths:** <narrowest> / <desktop>   **Themes:** light, dark, forced colors
- **Prior review:** <file> | first review

## Summary
P0 <n> | P1 <n> | P2 <n> | P3 <n>. One sentence on what works, one on the biggest problem.

## Heuristic scores
| # | Heuristic | Score | Prior | Worst finding |
|---|---|---|---|---|
| H1 | Visibility of system status | 3 | 2 | F07 |
| ... (all ten) |
| | Sum (trend only) / n/a count | 31 / 0 | 28 / 0 | |

## Persona walks
| Persona | Task | Result | Failed at |
|---|---|---|---|

## Findings
### F01 - P0 - <screen or route> - H5 / SC 3.3.1
<one-line claim, written as a statement>
<who is hurt and how, one or two sentences>
Evidence (<DOM | screenshot | judgment>):
    <the measurement with its threshold, or the verbatim quote; source value beside rendered value>
Direction: <the change, not the code>

## What works
Specific and measured, like the findings.

## Craft floor and state coverage
<the rule:craft-floor check result; the state table from frontend-and-perf.md>

## Performance
<measures with build, profile, run count>

## Unproven
<every visual or interactive row with no screenshot or browser proof, every walk not run, and why>

## Where to start
<ranked by impact over effort, with finding numbers>
```

Write findings as claims, not questions: "The submit button is a ghost button while the inert one is filled",
not "Have you considered the button hierarchy?".

## Trend

The next review of the same surface reads this file first and fills its "Prior" column. A heuristic that drops a
point is called out in the summary. A finding that returns after a fix is called out as a regression.
