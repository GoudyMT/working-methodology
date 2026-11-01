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

1. **Set the tier at plan approval:** feature, fix, triage, launch gate or first push, from rule:sweep-tiers; when unsure, the
   higher one. List the modifiers the change hits (security-sensitive, a new dependency or data flow, public or
   legal text, data the user keeps); each adds its role.
   Before the contract, `node .claude/tracking-check.mjs parking <plan>` passes (rule:parking-lot).
2. **The Swarm Contract, script first** (rule:swarm-contract). Do not ask the owner anything yet; the script decides
   whether there is anything to ask. In order: (a) commit the work; (b) draw the roles from
   [references/angles.md](references/angles.md) by the change's risk regions, and write them as
   `<sweep folder>/<milestone>-contract.json` (the format is in `approve.mjs`'s header; a role may name its `model`);
   (c) from the branch's own checkout, run `node <this skill's folder>/approve.mjs <contract.json>`
   (rule:sweep-auto-approval; its log is `kit-sweep-approvals.jsonl` in the repo's git folder). (d) APPROVED: post
   the start notice it printed, as is, and go on; never restate counts by hand. ASK THE OWNER: show the table and
   the reasons it printed, and stop; on the owner's yes, log it with `approve.mjs <contract.json> --owner-yes
   "<their words>"`, then go on. First push and launch gate always ask. A hook (`sweep-guard.cjs`) refuses any
   `reviewer` agent until the log clears this HEAD and this contract, so a new commit or an edited contract means
   running the script again. **Limits:** it stops slips, not a determined workaround: deleting or rewriting the log,
   a false `--base`, clearing the AI-shell marker, invented outcome numbers, or an `--owner-yes` the owner never gave
   would get past it, and each is a stop-and-tell-the-owner event. It checks a contract's shape, not whether each role's question fits its kind; the outcome trips catch that.
3. **Run the agents this session** as the `reviewer` role, against the branch HEAD, each with its role's context
   and a finding cap; each brief opens with the "Project rules" read instruction from the agent-team-build templates
   (rule:agent-canary). Findings go through rule:finding-pipeline; receive them per
   [references/receiving-findings.md](references/receiving-findings.md). A screen or flow in the change adds the
   ui-review skill's scored review as one role.
4. **Write the report** at `<sweep folder>/YYYY-MM-DD-<milestone>.md` (a triage report may sit in the PR body's
   gates), with `- **Tier:** <tier>` on its first lines, in the shape of the example for its tier. Run
   `node <this skill's folder>/audit.mjs <report.md>` and fix every fault.
5. **Fix, then the tier's re-sweep** (rule:sweep-tiers): the short re-sweep for feature, first push and launch gate, the fix
   check for a fix, none for triage unless it found something. Log the first sweep's outcome (step 6) BEFORE the
   re-sweep: the script clears no new contract until it is in. The re-sweep is a new contract on the new HEAD, run
   as `approve.mjs <re-sweep.json> --resweep <first contract.json>`: approved when every file changed since the
   first sweep is named in a role's context (one security role after a security-sensitive sweep). There is no third:
   a second re-sweep is refused. Its high and above are fixed now; medium and below go in the report as next-session
   clean-up items. Update the report. Summarize the result in the PR
   body by dimension and verdict, never by agent (rule:pr-body).
6. **Log the outcome** for the trial: `node approve.mjs <contract.json> --outcome --tokens <used> --findings <n>
   --real <n after triage> --duplicates <n repeated between roles>` (add `--real-mid <n>`: real findings from roles on
   the mid model, for the reviewer model trial). A bug later found in code the
   sweep passed: `--escape "<what>"`. `--summary` prints the trial so far; put its line in the rundown.

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
