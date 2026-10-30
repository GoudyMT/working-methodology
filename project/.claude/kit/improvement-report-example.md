# Improvement report: The owner was asked to approve a sweep team before the approval script ran

| Field | Value |
|---|---|
| ID | IR-2026-10-30-sweep-approval-miss |
| Date | 2026-10-30 |
| Project | course-project |
| Branch and commit | feat/v1-generator @ 6252562 |
| Kit version | 1.7.1 |
| Type | both |
| Severity | high |
| Kit area | rule:swarm-contract, rule:sweep-auto-approval, the pre-pr-sweep skill (step 2, approve.mjs) |
| Status | open |
| Lesson | L-01 in _Loop Learnings.md |
| Closed by | - |

## Summary

The lead asked the owner to approve a 6-role sweep team before running `approve.mjs`, the check that exists so a routine feature sweep needs no ask. The owner said yes to a team that broke the security floor. The script, run afterwards, refused it twice. Asking first was not only extra friction: it was less safe, because the owner approved on a wrong count.

## Timeline

1. Tasks 1-6 of PR 1 were done. The lead wrote a 6-role sweep team and asked the owner: "Is this team OK to run?"
2. The owner answered "Yes run those 6" and asked whether the kit had an auto-validate step.
3. Only then did the lead write the contract file and run `approve.mjs`. It refused on the security floor: the lead had called roles 1 to 3 "the three security angles", but supply chain and privacy are their own kinds, so only 1 counted. R7 (CI and history) and R8 (resource exhaustion) were added.
4. It refused again on the budget cap: 1,010,000 against 1,000,000. Three roles were trimmed by 10,000 each.
5. The third run said APPROVED: 8 roles, 980,000 tokens. The owner's yes had covered a team of 6 that failed the floor.

## Root causes

| # | Cause | Evidence | Proven or guess |
|---|---|---|---|
| 1 | The Swarm Contract rule led with the stop; auto-approval was a side note in brackets. | `standards/agent-teams.md:11`: "emit this table and STOP for the owner (or rule:sweep-auto-approval clears it)" | proven |
| 2 | The skill's step 2 put the owner first and the script second. | pre-pr-sweep `SKILL.md` step 2: "emit its table for the owner to read ... then ... run approve.mjs" | proven |
| 3 | The plan copied the old wording, so the plan itself said to ask. | `docs/superpowers/plans/2026-10-29-pr1-setup-and-generator.md:231`: "a Swarm Contract the owner approves" | proven |
| 4 | Nothing forced the script to run before a reviewer started; the order rested on the lead's memory. | No hook read `kit-sweep-approvals.jsonl` before an `Agent` call of the `reviewer` type (`.claude/settings.json` PreToolUse: canary only) | proven |
| 5 | The lead counted the security floor by hand and got it wrong; the script counts kinds exactly. | Timeline step 3: the script's first refusal, "needs 3 security role(s), has 1" | proven |

**Key cause:** #5 - the owner's yes rested on a hand count the script would have refused, so the order is a safety issue, not only friction.

## Impact

- **Owner:** one needless ask, and a yes given on wrong facts.
- **Quality:** a feature sweep below its security floor was approved by the owner; the script caught it before any reviewer ran.
- **Others:** every project on kit 1.5.0 to 1.7.1 that runs a sweep, and any agent that follows the rule text as written.

## Fixes

| # | Fix | Where in the kit | Kind | Standards effect |
|---|---|---|---|---|
| 1 | The rule opens script-first: write the contract, run `approve.mjs`; APPROVED -> post its notice and go; ASK -> show the table and reasons, stop. | rule:swarm-contract, rule:sweep-auto-approval | rule text | same |
| 2 | Skill step 2 in the same order: commit, contract, script, then the notice or the ask. | pre-pr-sweep `SKILL.md` step 2 | skill step | same |
| 3 | The script prints the owner's start notice from checked data: roles and kinds, model per role, budget against the cap, the floor met. | `approve.mjs` | script | higher |
| 4 | A hook refuses a `reviewer` agent until the log approves this HEAD and contract, or logs the owner's yes after the script's ASK (`--owner-yes`). | `kit-hooks/sweep-guard.cjs`, project `settings.json` | hook | higher |
| 5 | Plan wording follows the rule: no plan template in the kit carries the old line, so the rule text is the source plans copy. | rule:swarm-contract | rule text | same |

## What stays the same

- The floors: 3 security roles, a test-value role, the novel lens and the alignment verdict.
- The caps on agent count and token budget.
- The owner still decides on: an ASK from the script, any first push or launch gate, and every trial pause (every 10 approvals, a sweep 25% over budget, a third of findings repeated, a bug that escaped a passed sweep).
- Outcome logging after every sweep, and the report audit.
- Push, PR and merge stay the owner's.

## Decisions for the owner

- Reviewer model: all reviewers run on the top model today ("Keep the top model as reviewer until the scoreboard shows a cheaper one holds", `.claude/rules/testing.md:37`). Proposal: keep the 3 security roles and the novel lens on the top model, run supply chain, privacy, data validity and test value on the mid model as a logged trial, and re-check every high finding on the top model. This changes a kit rule, so it is the owner's call.

## Proof

- **Guard and control:** the kit tests run the sweep guard with no approval (refused), after an APPROVED line (allowed), after a new commit or an edited contract (refused), and after an ASK plus the owner's logged yes (allowed).
- **Next real use:** the next feature sweep in this project; look for the start notice posted as printed and no ask before the script.
- **Lesson:** L-01 in `_Loop Learnings.md`; if it recurs, the sweep guard is its guard.
