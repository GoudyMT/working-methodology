---
name: pre-pr-sweep
description: Run the sweep a branch needs before its pull request, at the tier its change calls for (feature, fix, triage or launch gate), and write the report the tier requires. Use before opening any PR (a draft after the first commit included) and before marking one ready, when a plan needs its sweep tier set, or when the owner asks for a sweep, a review or a security check. Serves rule:sweep-tiers.
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
   the reasons it printed, in one AskUserQuestion pop-up whose question quotes the act it printed (`sweep yes <code>`)
   in a code span, with an option starting "Yes" and one starting "No", and wait. After the owner's Yes, log it with
   `approve.mjs <contract.json> --owner-yes` (it reads the tap from this session's record and refuses without it),
   then go on. A pause is resumed the same way: the act is `sweep resume <code>`, then `approve.mjs --resume` run with CLAUDE_CODE_SESSION_ID set to the asking session's id (the pause ask prints the line). First
   push and launch gate always ask. A hook (`sweep-guard.cjs`) refuses any
   `reviewer` agent until the log clears this HEAD and this contract, so a new commit or an edited contract means
   running the script again. **Limits:** it stops slips, not a determined workaround: deleting or rewriting the log,
   a false `--base`, clearing the AI-shell marker, invented outcome numbers, or an `--owner-yes` the owner never gave
   would get past it, and each is a stop-and-tell-the-owner event. It checks a contract's shape, not whether each role's question fits its kind; the outcome trips catch that.
3. **Run the agents this session** as the `reviewer` role, against the branch HEAD (from another checkout, the brief names the cleared one), each with its role's context
   and a finding cap. **The brief is the file approve.mjs wrote for the role** (`<contract>-brief-<n>.md`, named
   when it clears the contract or logs the owner's yes): pass it as the prompt, as written (from 1.37.0, T6). It
   carries the rules block by line range, `Sweep: <hash> role <n>`, the role's `Call cap: <n>` (the hook's wording,
   or the count-it-yourself wording where no hook runs) and `Token ceiling: <n>`, the role's diff, a scratch folder
   of its own, and the report shape. The cap's last two calls are the refused one and the report; the hook stops a
   reviewer while this call, one more and the report still fit under the ceiling. What a role did not check goes
   in the report as not checked, never as a pass. The sweep guard refuses a brief without the three guard lines;
   the call-cap hook refuses a whole file over 40 KB; the canary checks the report's shape once at the hand-back.
   Findings go through rule:finding-pipeline; receive them per
   [references/receiving-findings.md](references/receiving-findings.md). A screen or flow in the change adds the
   ui-review skill's scored review as one role.
4. **Write the report** at `<sweep folder>/YYYY-MM-DD-<milestone>.md` (a triage report may sit in the PR body's
   gates), with `- **Tier:** <tier>` and `- **Covers:** <full sha of the commit the sweep read>` on its first lines (the merge gate reads it), in the shape of the example for its tier. A feature or launch-gate report also counts its highs and criticals by the layer that caught them: `- **Layers:** plan <n>, CI <n>, sweep <n>, escaped <n>` (plan: named by the plan gap check before the build; CI: a job failed on it; escaped: found after an earlier release). Sweep and escaped together cover every high the report lists, and each high's row names the roles that found it, so a later decision on the sweep's roles reads which highs only one kind of role caught. A report from before 1.31.0 writes `- **Layers:** not counted (swept before 1.31.0)` instead. Run
   `node <this skill's folder>/audit.mjs <report.md>` and fix every fault.
5. **Fix, each held to the test bar** (rule:finding-pipeline): one sweep per branch, no re-sweep. A fix that changes
   behaviour, guard and permission fixes above all, ships with a test that fails on the code before it and meets
   rule:test-value; a prose-only fix is proven by the recall eval or an invariant, and a removal or a wiring change
   adds no test (a removed behaviour's tests go with it); then push, and CI runs the
   full suite with auto-fix on red. Group the open findings with `node {{CLAUDE_HOME}}/kit-tools/lanes.mjs <findings.jsonl> [--files <files.json>]`: its lanes share no file, so each lane's fix can run in its own worktree, and a fix merges once its tests pass and CI is green, with no re-review. Log the sweep's outcome (step 6) once its reviewers hand back. A second pass is
   the owner's call: `approve.mjs` asks for any contract after a sweep that ran on this branch (a rebase or a new file
   name does not hide it), and refuses a re-sweep contract (`"resweepOf"`) flat. What the sweep found is fixed in this build; only a low or medium the owner says yes to (never a high or critical) goes to the handoff. The report's Covers line stays the
   commit the sweep read, and each fix is listed by its commit. In a project with a build record, each fix is
   a `sweep.fixes` row (id, severity, text, commit, test): the test that fails first, or `no test: no real input` for
   a low or medium no real input shows; CI's test check states each named test's verdict, and the PR claims only that. Summarize the result in the PR body by dimension and verdict, never by agent
   (rule:pr-body).
6. **Log the outcome** for the trial: `node approve.mjs <contract.json> --outcome --agents <id,...> --findings <n>
   --real <n after triage> --duplicates <n repeated between roles>` (`--agents auto` finds each reviewer from its brief's Sweep tag, so ids lost to a compaction do not end a sweep; or each reviewer's agent id, one per
   role in the contract's order, from each Agent result, noted as they finish; the script reads each finished reviewer's processed tokens from its transcript; an approval no reviewer started under: `--outcome --none-ran`; a reviewer that crashed (no report, not finished, its transcript quiet for 10 minutes): `node approve.mjs <contract.json> --retry <n> --crashed <id>` gives role n one more start with the same brief, and `--agents` names the retry. A crash's tokens count against its role's budget; a sweep cut short, where none of these works (a role's second crash, the ids were lost): `--outcome --cut-short`, then the next contract asks the owner, whose yes closes it unmeasured; a sweep that fixes
   carried findings adds `--closed-carries <n>`; add `--real-mid <n>`: real findings from roles on
   the mid model, for the reviewer model rule). When every role handed back a report in its shape, the script
   counts `--findings` from the reports, writes `<contract>-ledger.md` (one row per finding) and refuses a count
   that differs; `--real` and `--duplicates` stay the lead's triage, and the ledger marks findings two roles placed
   on the same line. A bug later found in code the
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
