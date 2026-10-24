---
name: scope-and-value
description: Read when planning a cycle, when ideas or fixes pile up, or when a size budget is about to be exceeded.
metadata:
  type: feedback
---

- **Plan the whole cycle before branching.** Map every task needed to call the goal met, the edge cases, what we use, and what is out. One cycle should usually be one branch. Why: a trail of small follow-up branches each costs its own branch, PR, CI and merge, and reads as motion while the goal sits untouched.
- **With more than two units left, plan the rest as one batch.** Read-only investigators with one distinct question each -> small probes for timing or platform assumptions -> one plan with cross-unit interactions resolved -> one pass.
- **Parking lot.** An out-of-scope idea mid-build gets one line in the plan's Parking Lot (idea - where noticed - hunch now or next). Keep working. After gates pass and before the sweep, route each item: now (small, in spirit, owner locks scope), next (roadmap), or drop (one-line why). The lot ends empty. Why: kills silent scope creep and lost ideas at once.
- **Value check on a fix stream.** Tier work by what a person would notice (high: someone hits it; medium: correctness for keyboard or screen-reader users; low: millisecond races, byte trims, test hygiene). Say the tier at each checkpoint. When reviews return smaller things, recommend stopping and shipping - before the owner has to ask.
- **Audit a long branch against the objective.** List commits grouped by what they buy the user; name overhead plainly. A fix can be the cumbersome thing - cut it and keep the part that is clearly right.
- **A sweep generates work faster than value.** The value lens ends the loop, not fatigue.
- **Size budgets: trim before you ask.** Budgets are self-imposed anti-bloat limits. At an overage: (1) search the bucket for bloat and measure each saving; (2) land each trim as its own commit, proven behavior-free; (3) only then request more room with the shortfall, what was searched, and the number. Moving bytes between budgets is a request too.
- **A precedent does not transfer until measured.** Measure each trim on the file it touches; know the build-to-build noise and keep about 40 B of headroom against CI drift.
- **Security code is never a trim candidate.** Trim briefs carry an allow-list of files; a write outside it pauses the work.
- **No repeated boilerplate in user-facing copy.** A sentence that already lives on other surfaces adds nothing on a new one and dilutes where it matters.

Related: [[findings-pipeline]], [[goals-and-design-thinking]].
