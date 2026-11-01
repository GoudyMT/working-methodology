# Improvement report: Sweep loop: auto-approved contract, fix, auto-approved targeted re-sweep

| Field | Value |
|---|---|
| ID | IR-2026-10-31-sweep-loop-auto-approved-contract-fix-auto-approved-targeted |
| Date | 2026-10-31 |
| Project | sample-app |
| Branch and commit | feature/separation-path @ b86f5753 |
| Kit version | 1.12.1 |
| Type | both |
| Severity | medium |
| Kit area | skills/pre-pr-sweep/approve.mjs (rule:sweep-auto-approval, rule:sweep-tiers re-sweep step) |
| Status | open |
| Lesson | none |
| Closed by | - |

## Summary

The owner's sweep loop is: one primary sweep, auto-approved when its contract fits the rules; fix what it finds;
one short re-sweep of the areas those fixes touched, to confirm nothing broke or went astray, also auto-approved when
it fits. No third sweep: a re-sweep finding of high severity or above is fixed now; medium and below become clean-up
items for the next session. The approval script has no re-sweep mode, so it holds a targeted re-sweep to the full
tier floor and sends it to the owner, who was asked to approve a re-sweep that followed the rule exactly.

## Timeline

1. 2026-10-31: the feature sweep (8 roles) on `3e7a8e13` was APPROVED by `approve.mjs`.
2. The 3-role re-sweep scoped to the fixes on `e8dc206` got "ASK THE OWNER": needs 3 security roles, has 2; needs a
   test-value, content and data-loss role, has none.
3. The owner approved it and asked why the script did not, and stated the loop as a standing rule (20:25 UTC).
4. That re-sweep found a real fault; its fixes got a 2-role targeted re-sweep on `b86f575`, which the script again sent
   to the owner; it was logged with `--owner-yes` quoting the standing rule. A third was started and stopped.
5. The owner settled the loop (20:36 UTC): one primary sweep, one short re-sweep of the fixed areas, no third; re-sweep
   findings high and above fixed now, medium and below carried to the next session as clean-up items.

## Root causes

| # | Cause | Evidence | Proven or guess |
|---|---|---|---|
| 1 | approve.mjs applies the tier floor to every contract; it cannot tell a re-sweep from a first sweep | `approve.mjs docs/sweeps/2026-10-31-separation-path-resweep-contract.json` printed "ASK THE OWNER ... needs 3 security role(s), has 2" | proven |
| 2 | The skill's step 5 says a re-sweep below the floor goes to the owner, so the ask is by design, not a bug | pre-pr-sweep SKILL.md step 5: "it may fall below the tier's floor, and then the script asks and the owner decides" | proven |
| 3 | The old cadence allowed a third pass only for a major finding; the owner's loop re-sweeps after every fix round | the owner, 2026-10-31 20:25 UTC, in the separation-path thread | proven |

**Key cause:** #1 - without a re-sweep mode, the owner's loop can never run without an ask.

## Impact

- **Owner:** two approval asks for contracts that followed the stated rule; one message to ask why.
- **Quality:** none lost; the asks added delay, not checks.
- **Others:** every kit project running the feature, first-push or launch-gate tier.

## Fixes

| # | Fix | Where in the kit | Kind | Standards effect |
|---|---|---|---|---|
| 1 | A `--resweep <first contract>` mode: the floor becomes "every root fixed since the parent sweep has a role whose context names the touched files", with at least one security role when the parent had a security modifier; HEAD must descend from the parent's HEAD | approve.mjs | script | same |
| 2 | The loop as the rule: one primary sweep, fix, one short targeted re-sweep of every touched area, no third; re-sweep findings high and above fixed now, medium and below recorded as next-session clean-up items (the report names them); both approvals automatic inside the rules | rule:sweep-tiers, pre-pr-sweep step 5, rule:finding-pipeline | rule text | same |
| 3 | The outcome log links a re-sweep to its parent, so the trial counts passes per feature | approve.mjs `--outcome` | script | same |

## What stays the same

- The first sweep's tier floor, modifiers and the mid-model trial limits.
- First push and launch gate still always ask.
- Every finding still goes through the finding pipeline; a high finding still needs a disposition in the report.

## Decisions for the owner

- None. The owner set the cap on 2026-10-31: one re-sweep, no third; its findings high and above fixed now, medium
  and below carried to the next session.

## Proof

- **Guard and control:** run `approve.mjs --resweep` on `docs/sweeps/2026-10-31-separation-path-resweep2-contract.json`
  (2 roles, context covering both fixed roots): APPROVED; drop the backup role: ASK (a fixed root with no role).
- **Next real use:** the next feature sweep in this project; look for zero owner asks on targeted re-sweeps.
- **Lesson:** none.
