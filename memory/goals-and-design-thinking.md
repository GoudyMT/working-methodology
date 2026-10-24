---
name: goals-and-design-thinking
description: Read at design time - when a request names a mechanism, when a goal is stated as an experience, or before building uncertain work.
metadata:
  type: feedback
---

- **Explore the goal, not the named mechanism.** "Rework the calendar download" names one candidate. Restate the goal in one line ("be reminded at three moments"), then the current state against it, then every channel. Why: widening to the goal often finds the real defect the mechanism hid.
- **Map an experience goal to the layer that emits it.** Restate the goal as what the user SEES, then ask which layer produces that, and write it down before touching code. The knob on the surface you are already editing is suspect. Why: shortening the first N words gives preamble, never an answer; the right layer was which words, not how many.
- **Check the capability exists before tuning its presentation.** Grep where the output is produced and under what conditions. A feature gated off for most people is absent.
- **A measurement that says "this knob cannot reach the goal" means change layer**, not pick a middle value on the same knob.
- **Sequence by the tier people hit first**, not by the part you understand best.
- **Run the measurement that decides the thing before building toward it.** Ask what one cheap check would show the outcome is unreachable, and run it first. Pre-register the bar before seeing the result so nobody can move it.
- **Success Charter for high-uncertainty work:** expectations in plain words, measurable criteria (qualitative where a number would be invented), options tied to the criteria, a scaling trigger and path, and ambition tiers with the stretch gated. Scale rigor to stakes.
- **Empirical build-gates.** A load-bearing claim about browser behavior, a third-party API's real limits, or platform isolation is a gate, not a fact, until a real probe passes. Build nothing on it before then. Ship the de-risked local part first; put the risky integration behind its probes.
- **Build seam-first.** Inject the dependency a later mode will swap (local vs server answering) so the later arc is additive, not a rewrite.
- **Fix the root, not the lazy shortcut.** When reality diverges from the agreed design, offer the scoped root fix as a first-class option, weighed honestly against the work-around. Scale to stakes.
- **No usage-scaling cost** for a project without revenue: any paid tier must degrade, never bill, and needs a hard spend cap.

Related: [[collaboration-and-decisions]], [[measurement-and-evals]], [[visual-and-ux-design]].
