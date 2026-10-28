---
name: pre-pr-sweep
description: Run the sweep a branch needs before its pull request, at the tier its change calls for (feature, fix, triage or launch gate), and write the report the tier requires. Use before opening any PR, when a plan needs its sweep tier set, or when the owner asks for a sweep, a review or a security check. Serves rule:sweep-tiers.
---

# Pre-PR Sweep

Serves rule:sweep-tiers, rule:pre-pr-deep-sweep and rule:milestone-sweep. The project's adapter row A22 names
the sweep folder; rule:finding-pipeline sets the passes.

## The rule

Read rule:sweep-tiers, rule:pre-pr-deep-sweep and rule:milestone-sweep in full first (the project's
reviews-and-findings rules): the tiers, the modifiers that add roles, the six dimensions and when a report counts
as done. This skill adds the steps, the examples and the audit; it never restates the rules.

## Steps

1. **Set the tier at plan approval:** feature, fix, triage or launch gate, from rule:sweep-tiers; when unsure, the
   higher one. List the modifiers the change hits (security-sensitive, a new dependency or data flow, public or
   legal text, data the user keeps); each adds its role.
2. **Feature and launch gate:** emit the Swarm Contract table (rule:swarm-contract) and stop for the owner's
   approval. **Fix and triage:** the roles the tier names, plus any modifier's, stated in the plan.
3. **Run the agents this session** against the branch HEAD, read-only, each with its role's context and a
   finding cap. Findings go through rule:finding-pipeline.
4. **Write the report** at `<sweep folder>/YYYY-MM-DD-<milestone>.md` (a triage report may sit in the PR body's
   gates), with `- **Tier:** <tier>` on its first lines, in the shape of the example for its tier. Run
   `node <this skill's folder>/audit.mjs <report.md>` and fix every fault.
5. **Fix, then the tier's re-sweep** (rule:sweep-tiers): the short re-sweep for feature and launch gate, the fix
   check for a fix, none for triage unless it found something. Update the report. Summarize the result in the PR
   body by dimension and verdict, never by agent (rule:pr-body).

## The audit

`audit.mjs` holds the report to its tier: every report names its tier, a date, the branch and a commit, and
dispositions every high or critical finding (`FIXED <commit>`, `DEFERRED <where>` or `ACCEPTED <why>`, in a
findings table or a finding bullet), and names all six dimensions (a result, findings or "not touched").
Feature, fix and launch-gate reports also give the version-goal verdict, YES or NO; a triage report names its
secrets and personal-data check. It cannot tell
whether the agents really ran; only their output in this session proves that.

## Examples

- [examples/feature-sweep.md](examples/feature-sweep.md) - feature tier, with the security-sensitive modifier.
- [examples/fix-sweep.md](examples/fix-sweep.md) - fix tier.
- [examples/triage-sweep.md](examples/triage-sweep.md) - triage tier.

All are adapted from real reports or built from the rule, with the product, names and numbers replaced.
