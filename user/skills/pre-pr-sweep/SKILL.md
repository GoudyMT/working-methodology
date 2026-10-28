---
name: pre-pr-sweep
description: Run the Pre-PR Deep Sweep on a branch before any substantive pull request, under an approved Swarm Contract, and write its report in the project's sweep folder. Use before opening a PR for a feature, a sub-project or anything with new behaviour, security, privacy or legal relevance, or when the owner asks for a sweep or a deep review. Serves rule:pre-pr-deep-sweep.
---

# Pre-PR Deep Sweep

Serves rule:pre-pr-deep-sweep, the deep tier of rule:milestone-sweep. The project's adapter row A22 names the
sweep folder; rule:finding-pipeline sets how many passes.

## Steps

1. **Scope it:** confirm the PR is substantive (rule:milestone-sweep, trigger 1). A trivial chore, docs or
   one-line PR gets a light pass or a stated exemption instead.
2. **Contract first:** emit the Swarm Contract table (rule:swarm-contract) - distinct roles, the count derived
   from the risk regions, one novel-lens slot - and stop for the owner's approval.
3. **Run the agents this session** against the branch HEAD, read-only, each with its role's context and a
   finding cap. Findings go through rule:finding-pipeline.
4. **Write the report** at `<sweep folder>/YYYY-MM-DD-<milestone>.md` (the shape in the examples), then run
   `node <this skill's folder>/audit.mjs <report.md>` and fix every fault.
5. **Fix, then one short re-sweep** of the touched areas only (rule:finding-pipeline, "Two passes"); update the report.
   Summarize the report's result in the PR body by dimension and verdict, never by agent (rule:pr-body).

## The rule

- **Adversarial vulnerability swarm:** >= 3 top-tier security agents with DISTINCT angles.
- **A Test Value agent** ruling keep / cut / repoint on every added or edited test (the use guarded, a break check where in doubt); retired when reviews stop finding fluff.
- **Every high / critical independently re-checked** - an input to the controller's adjudication. **Dimension 6 mandatory.** **Covers the branch HEAD** - an older report does not count; re-run or sweep the delta.
- **Anti-hallucination clause:** satisfied ONLY by the agents actually running THIS session AND the report existing with their findings, dispositions and verdict - never by the controller's read, a recalled sweep, or "it looks fine". No report -> no PR.

## The audit

`audit.mjs` checks the done-condition of rule:milestone-sweep: a date, the branch and a commit; all six
dimensions named; every high or critical finding dispositioned `FIXED <commit>`, `DEFERRED <where>` or
`ACCEPTED <why>`; and the version-goal verdict, YES or NO. It cannot tell whether the agents really ran; only
their output in this session proves that.

## Examples

- [examples/feature-sweep.md](examples/feature-sweep.md) - a feature PR's full sweep.
- [examples/small-sweep.md](examples/small-sweep.md) - a smaller PR's sweep.

Both are adapted from real reports, with the product, names and numbers replaced.
