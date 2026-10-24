---
name: findings-pipeline
description: Read when a sweep, review or checker returns findings - how to judge, cluster, fix and defer them.
metadata:
  type: feedback
---

**A finding is a hypothesis, not a work order.** It carries five unknowns: is it true, reachable, why it breaks, the confirmed fix method, the blast radius. Collapsing them into "read finding -> write fix" caused rounds of rework across shipped code.

**The pipeline:** triage -> diagnose (name the CLASS; it gives you a grep) -> cluster and search repo-wide (a barrier: nothing is fixed until every finding clears it) -> confirmed method (what side effects must the fix PRESERVE?) -> blast radius (owner's go) -> one root per commit.
- **A diagnosed root is a search pattern**; an undiagnosed symptom is whack-a-mole.
- **Re-sweep once over the whole batch**, never after each fix. Sweep -> fix -> sweep is an undamped loop.
- **Watch the "moved to a better seam, dropped a side effect" shape.** It caused half of one batch's regressions.

**Truth bar.** A finding is true by (1) a red test someone watched, or (2) a quoted offending line + the hard rule + an in-repo precedent enforcing that rule on that class. "Cannot be made to fail" is not "not real" (memory hygiene has no observable symptom). If the class is observable, the red test is mandatory. Reachability sets severity, not truth. Sweep agents return candidates; the controller rules.

**A fix is new code.** Give it the scrutiny the old code got, most of all when it changes shape. Sync -> async opens stale-write and unhandled-rejection windows; a lazy seam opens a not-ready window and cached-rejection risk. Name the new failure class, then grep for the invariant the codebase already enforces for that shape and mirror it.

**Fix a shared finding at its root.** A finding at N call sites often has one shared token or util. Grep the pattern repo-wide first; fix once and gate it.

**Features first; findings ride inside the PR.**
- A standalone fix PR only for harm: data loss, a stuck user, a silent outage.
- Sweep findings are fixed in their PR; defer only the extremely minor (info, cosmetic, rare), each recorded.
- **Small and easy -> now**, not filed. Only large, risky, device-only or design items go to the roadmap, and all are recorded.
- At a run's start the owner picks the feature first; earlier leftovers build on its branch; one large sweep after both, one PR.

Related: [[review-and-sweeps]], [[scope-and-value]], [[testing-discipline]].
