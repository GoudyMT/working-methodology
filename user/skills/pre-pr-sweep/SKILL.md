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
   `<sweep folder>/<milestone>-contract.json` (the format is in `approve.mjs`'s header; a role may name its `model`, and
   sets `calls`, its call cap, 15 unless it names why it needs more: the script computes the budget from it; a budget over a
   `maxRoleBudget` or `maxTotalBudget` in the project's `.kit/sweep-approval.json` asks the owner);
   (c) from the branch's own checkout, run `node <this skill's folder>/approve.mjs <contract.json>`
   (rule:sweep-auto-approval; its log is `kit-sweep-approvals.jsonl` in the repo's git folder). (d) APPROVED: post
   the start notice it printed, as is, and go on; never restate counts by hand. FIX THE CONTRACT (exit 3): the mistake is
   yours; add what it named and run it again, the owner is not asked (going lighter at that HEAD asks the owner). ASK THE OWNER: show the table and
   the reasons it printed, and stop; on the owner's yes, log it with `approve.mjs <contract.json> --owner-yes
   "<their words>"`, then go on. First push and launch gate always ask. A hook (`sweep-guard.cjs`) refuses any
   `reviewer` agent until the log clears this HEAD and this contract, so a new commit or an edited contract means
   running the script again. **Limits:** it stops slips, not a determined workaround: deleting or rewriting the log,
   a false `--base`, clearing the AI-shell marker, invented outcome numbers, or an `--owner-yes` the owner never gave
   would get past it, and each is a stop-and-tell-the-owner event. It checks a contract's shape, not whether each role's question fits its kind; the outcome trips catch that.
3. **Run the agents this session** as the `reviewer` role, against the branch HEAD (from another checkout, the brief names the cleared one), each with its role's context
   and a finding cap; each brief carries its role's `calls` from the contract in these words:
   "Call cap: <n>. A call is one message from you, however many tools it runs, so run independent reads together in one message. A hook counts
   your calls and refuses tools at the end of the cap; when it does, hand in your report at once, with what you did
   not get to as 'not checked'." In a project the start notice says has no hook, drop the hook sentence and have the reviewer count. The cap's last two calls are for the report. What a role did not check goes in the
   report as not checked, never as a pass. Each brief also carries `Sweep: <hash> role <n>` from the start notice
   (n is the role's place in the contract). The sweep guard refuses a brief without both lines. The brief carries the
   diff (`git diff <base>...HEAD` for the files its role reads), not whole files: the reviewer reads more by range,
   and the call-cap hook refuses a whole file over 40 KB. Each brief opens with the "Project rules" read instruction from the agent-team-build templates
   (rule:agent-canary). Findings go through rule:finding-pipeline; receive them per
   [references/receiving-findings.md](references/receiving-findings.md). A screen or flow in the change adds the
   ui-review skill's scored review as one role.
4. **Write the report** at `<sweep folder>/YYYY-MM-DD-<milestone>.md` (a triage report may sit in the PR body's
   gates), with `- **Tier:** <tier>` and `- **Covers:** <full sha of the commit the sweep read>` on its first lines (the merge gate reads it), in the shape of the example for its tier. Run
   `node <this skill's folder>/audit.mjs <report.md>` and fix every fault.
5. **Fix, each with a test that fails first** (rule:finding-pipeline): one sweep per branch, no re-sweep. Every fix,
   guard and permission fixes too, ships with a test that fails on the code before it; then push, and CI runs the
   full suite with auto-fix on red. Log the sweep's outcome (step 6) once its reviewers hand back. A second pass is
   the owner's call: `approve.mjs` asks for any contract after a sweep that ran on this branch (a rebase or a new file
   name does not hide it), and for a re-sweep contract (`"resweepOf"`, `"fixed"`; its roles are one blast-radius, one per
   fixed kind and one `dimension`). After a re-sweep, what is left at medium or below is logged with `--carried <n>` and goes to the handoff; a high or critical is fixed or the owner accepts it. Update the report, its Covers line to
   the HEAD the fixes reached. Summarize the result in the PR body by dimension and verdict, never by agent
   (rule:pr-body).
6. **Log the outcome** for the trial: `node approve.mjs <contract.json> --outcome --agents <id,...> --findings <n>
   --real <n after triage> --duplicates <n repeated between roles>` (`--agents auto` finds each reviewer from its brief's Sweep tag, so ids lost to a compaction do not end a sweep; or each reviewer's agent id, one per
   role in the contract's order, from each Agent result, noted as they finish; the script reads each finished reviewer's processed tokens from its transcript; an approval no reviewer started under: `--outcome --none-ran`; a reviewer that crashed (no report, not finished, its transcript quiet for 10 minutes): `node approve.mjs <contract.json> --retry <n> --crashed <id>` gives role n one more start with the same brief, and `--agents` names the retry. A crash's tokens count against its role's budget; a sweep cut short, where none of these works (a role's second crash, the ids were lost): `--outcome --cut-short`, then the next contract asks the owner, whose yes closes it unmeasured; a re-sweep adds
   `--carried <n>`, a sweep that fixes carried findings `--closed-carries <n>`; add `--real-mid <n>`: real findings from roles on
   the mid model, for the reviewer model trial). A bug later found in code the
   sweep passed: `--escape "<what>"`. `--summary` prints the trial so far; put its line in the rundown.

## The audit

`audit.mjs` holds the report to its tier: every report names its tier, a date, the branch and a commit, and
dispositions every high or critical finding (`FIXED <commit>` or `ACCEPTED owner <why>`, in a findings table or a
finding bullet; `DEFERRED <where>` is for medium and below), and names all six dimensions (a result, findings or "not touched").
Feature, fix and launch-gate reports also give the version-goal verdict, YES or NO; a triage report names its
secrets and personal-data check. It cannot tell
whether the agents really ran; only their output in this session proves that.

## Examples

- [examples/feature-sweep.md](examples/feature-sweep.md) - feature tier, with the security-sensitive modifier.
- [examples/fix-sweep.md](examples/fix-sweep.md) - fix tier.
- [examples/triage-sweep.md](examples/triage-sweep.md) - triage tier.

All are adapted from real reports or built from the rule, with the product, names and numbers replaced.
