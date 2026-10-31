---
name: ui-review
description: Review a built screen or flow before its PR - the scored design review (Nielsen 0-4, P0-P3), 2-3 persona walks, WCAG 2.2 AA checks, front-end and performance checks - and write a report whose scores are kept for the trend. Use when a UI change is built and before its sweep or PR, or when the owner asks for a UI review, design review, design critique, UX review, usability review, heuristic evaluation, accessibility audit or a11y check of a screen. Serves rule:craft-floor.
---

# UI Review

Serves rule:craft-floor (its "Scored review", "Audit before editing" and "Judgment before the tools" lines are the
spine of this skill). Read rule:craft-floor and rule:visual-design-collaboration in full first; this skill adds
the steps, the prompts, the checks and the report. It never restates them.

Why: "looks fine" is not a bar. A scored review with evidence makes a screen's quality checkable, and the kept
scores show whether the product gets better or worse over time.

## When it applies

- A screen, page, board or flow is BUILT (it runs, with real data) and its PR is next. A design not yet built
  goes through rule:visual-design-collaboration instead (wireframe first).
- The owner asks for a UI, UX, design or accessibility review, a critique or a heuristic evaluation.
- Not for: a change with no user-facing surface (say so in one line and stop); build-time craft choices (that is
  the ui-craft skill's job); the break-it testing of rule:pre-push-op-test, which runs later and separately.

Why: one review at the right moment beats three overlapping ones.

## Steps

1. **Frame it.** Name the surface's job (operate, read, persuade - rule:craft-floor). List the screens and flows
   in scope, the widths (the project's narrowest, from adapter A21, and a desktop width), the themes (light,
   dark, forced colors where state marks change), and the branch and commit. Find the last review of the same
   surface in the sweep folder (adapter A22) and copy its scores into the trend column.
   **Done when:** a scope block exists naming job, screens, widths, themes, commit and the prior review (or "first
   review").

2. **Run it for real.** Serve the build with real data and real-length text (rule:visual-design-collaboration).
   Take a screenshot of each screen at each width and theme. Never type a real secret; use the project's test
   values. Block any endpoint that sends a real message outside the project (rule:outward-acts).
   **Done when:** the shots exist and their paths are listed. No browser -> every visual or interactive row goes to
   "Unproven" in step 7, never to pass.

3. **Opinion first.** Before any tool runs, look at each screen and write the design opinion: the two-second first
   impression, then the ten heuristics with the prompts in [references/heuristics.md](references/heuristics.md),
   then the reading pass in the same file (copy, claims, names, empty states, the central promise). Give each
   heuristic a provisional score.
   **Done when:** a written opinion and ten provisional scores exist, and no automated check has run yet.

4. **Walk it as 2-3 people.** The first-timer, the person who relies on accessibility, and the distracted phone
   user, with the prompts in [references/persona-walks.md](references/persona-walks.md). Each walk names the exact
   element where it failed. Walks by agents are a swarm: write the Swarm Contract first (rule:swarm-contract).
   **Done when:** each walk has a result line - completed or stuck, and at which element.

5. **Measure.** Run the craft-floor check (rule:craft-floor), then the accessibility checks in
   [references/wcag-22-aa.md](references/wcag-22-aa.md), then the front-end and performance checks in
   [references/frontend-and-perf.md](references/frontend-and-perf.md). Measure from the DOM and computed styles
   where a number exists; use the screenshot only for what structure cannot show.
   **Done when:** every row in those files is pass, a finding, n/a with a reason, or Unproven.

6. **Merge opinion and measurement.** A tool hit the opinion missed is a finding. An opinion a tool contradicts is
   re-checked, then kept or dropped with the reason. Then fix the scores: each heuristic's score comes from its
   worst finding (the rule is in [references/scoring.md](references/scoring.md)).
   **Done when:** every opinion item is confirmed, dropped with a reason, or kept as labelled judgment.

7. **Rank and prove each finding.** Rank P0-P3 (rule:craft-floor). Each finding carries a measurement or a
   verbatim quote, the element, and the heuristic or WCAG criterion. Retest an intermittent defect at least four
   times and report every attempt. Anything not proven goes under "Unproven".
   **Done when:** no finding lacks evidence, and no unproven row is marked pass.

8. **Write the report** in the shape of [references/scoring.md](references/scoring.md), in the sweep folder, with
   the trend column filled. Run rule:fact-check on it before it goes to anyone.
   **Done when:** the report file exists, its fact-check line is on top, and its scores sit beside the last ones.

9. **Hand the findings on, do not fix them here.** Findings are hypotheses: they go through rule:finding-pipeline
   (triage, cluster by root, fix the root, one root per commit). A good screen gets small refinements, never a
   redesign (rule:craft-floor). Any change to how the product looks is Path 1 (rule:edit-discipline) or needs the
   owner's lock (rule:visual-design-collaboration). Value check: recommend stopping when the review returns only
   P3s (rule:features-first).
   **Done when:** each finding has a disposition path, and the rundown names the P0 and P1 count.

Why this order: opinion before tools keeps the review from becoming a list of scanner hits; measuring before
ranking keeps the ranks honest; fixing later keeps one root per commit.

## Evidence rules

- A finding is a claim: a number with its threshold, or a quote of the text on screen. "The hierarchy could be
  stronger" is not a finding. Why: a vague finding cannot be checked, so it gets skimmed.
- Say which layer a finding rests on: a DOM measurement, a screenshot, or reasoned judgment. Never dress a
  judgment as a measurement (no ratio guessed from a screenshot). Why: one fake number spends the credit of all
  the real ones.
- Credit what works, with numbers. Why: it tells the team which foundations not to touch.
- The project's own design system, style guide and locks win over every default in the references. Why: a house
  rule is checkable; a generic rule is a guess about this product.

## References

Why: the detail loads only when its step needs it.

- [references/heuristics.md](references/heuristics.md) - prompts for each of Nielsen's ten, the reading pass, the
  law-based counts (Hick, Fitts, Miller, design-system drift).
- [references/persona-walks.md](references/persona-walks.md) - the three walks, their prompts, the result line.
- [references/wcag-22-aa.md](references/wcag-22-aa.md) - the WCAG 2.2 AA criteria that matter most, with numbers.
- [references/frontend-and-perf.md](references/frontend-and-perf.md) - states, tokens, motion, code patterns,
  performance budgets.
- [references/scoring.md](references/scoring.md) - ranks, the score rule, the report shape, the trend.
