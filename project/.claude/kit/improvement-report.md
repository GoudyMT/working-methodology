# Improvement report: <one-line title>

| Field | Value |
|---|---|
| ID | <IR-YYYY-MM-DD-slug> |
| Date | <YYYY-MM-DD> |
| Project | <project folder name> |
| Branch and commit | <branch> @ <short commit> |
| Kit version | <x.y.z> |
| Type | <process, method or both> |
| Severity | <high, medium or low> |
| Kit area | <the rule, skill, script, hook, template or role file at fault> |
| Status | open |
| Lesson | <L-NN in _Loop Learnings.md, or none> |
| Closed by | <the kit version that closes it; leave "-" while open> |

<!--
Fill this in the session the gap shows up, then hand the file to the kit as is. `improvement-report.mjs audit
<file>` must PASS first.
Type: process = how we work (step order, who decides, hand-offs); method = a rule, check, script, hook or template.
Severity: high = a standard was broken or could have been; medium = rework or owner time lost; low = friction.
Status: open (here) -> filed (handed to the kit) -> accepted or declined (the kit's call) -> closed (a release fixed it).
Plain words to the owner; full rigour in the tables. Every cause carries evidence; a guess is labelled "guess".
-->

## Summary

<Two or three plain sentences: what went wrong, and what it cost.>

## Timeline

1. <Facts only, in order.>

## Root causes

| # | Cause | Evidence | Proven or guess |
|---|---|---|---|
| 1 | <the cause> | <file:line, a short quote, a command output or a log line> | <proven or guess> |

**Key cause:** #<n> - <why this one matters most>

## Impact

- **Owner:** <time spent, asks, or a decision made on wrong facts>
- **Quality:** <a standard broken or put at risk>
- **Others:** <who else would hit it: other projects, agents, AI tools>

## Fixes

| # | Fix | Where in the kit | Kind | Standards effect |
|---|---|---|---|---|
| 1 | <what changes> | <a file or rule ID> | <rule text, skill step, script, hook, template, role file or other> | <same or higher> |

<!-- A fix never lowers a standard. A change that would is not a fix: it goes under "Decisions for the owner". -->

## What stays the same

- <each standard, floor, cap or owner decision this leaves as it is>

## Decisions for the owner

- <a decision only the owner can make, with a recommendation and why; or "None">

## Proof

- **Guard and control:** <the check that catches a repeat, and a run showing it fails without the fix>
- **Next real use:** <where the fix is used next, and what to look for>
- **Lesson:** <the lesson ID and where it is recorded, or "none">
