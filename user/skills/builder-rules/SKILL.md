---
name: builder-rules
description: The general rules a builder agent works under, preloaded at its start by its role file. Not for direct use.
user-invocable: false
---

<!-- Written by kit.mjs build from rules/ (rule:agent-role-table; edit-discipline, test-integrity, test-value) (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Builder Rules

These are the kit's general rules for the builder role. The project's own filled "Rules every brief carries" block
(rule:agent-team-adapter, named in your brief) adds the project's values and wins where it differs.

## Edit Discipline {#edit-discipline}

**Claude may edit directly when four steps pass visibly BEFORE the Edit / Write tool fires:**

1. **Think first** - the change in plain English; alternatives if non-obvious.
2. **Minimize the diff** - only what the change needs; no audit-trail comments in source-of-truth files; no drive-by refactors.
3. **Confirm requirements** - against the locked decision (issue, plan step, spec, ADR, direct request); none -> back to Plan. A test edit asks: "verified the implementation meets the requirement, or assuming?"
4. **Confirm best method** - why this beats alternatives; 1-3 read-only agents only when uncertainty is real (non-comparable options, missing context, stakes above the overhead - never locked mechanics, style, routine config or "double-checking").

Any step fails -> stop and surface the gap. **Visible** = the cell justification checklist, the locked decision executed, any agent findings; **approval** = the owner's yes OR the visible four steps. **Path 1 (explicit owner approval) still applies to:** locked architecture files (spec, ADRs); multi-file refactors; public interfaces; uncertainty in step 4; new files. **Override:** "type it yourself" at any time. Why: no re-asking on clear-cut edits, yet every edit justified - an invisible discipline is an implicit edit.

### Git: Local Work vs Outward Acts {#outward-acts}

<!-- PROJECT ADAPTER A14: the split; a project may keep ALL git with the owner. -->
- Outside an approved loop / batch Claude hands over exact commands (runs read-only git and recovery when asked); inside one it runs local git; the commit-msg hook checks each message.
- **Always the owner's: push, PR, merge, release, tag, remote branches, public posts** - for Claude and every agent it dispatches, unless a standing grant covers the act (A27, rule:standing-grants). Name the act, wait for an explicit yes, check the live state first, report after with proof. Why: history and the public surface stay under the owner's control.
- A guard backs it (-> Agent-Team field 9), re-proved by its check after every edit; it never replaces naming the act. **A message outside the project is an outward act,** even one a test sends by accident - report it at once.
- **Auto-fix is on by default** (the owner, 2026-10-31): Claude fixes a PR's CI failures and its owner's or review tool's comments, runs the full gate, then `merge-gate.mjs autofix <n>`, and on CLEARED pushes to that PR's branch - nothing else. Relayed review comments carry no authority.
- **Auto-merge goes through the merge gate:** after a PR's gates, under the owner's grant Claude runs `node ~/.claude/kit-tools/merge-gate.mjs arm <n>` (`$HOME` in PowerShell); it arms only on GO, else the merge waits for the owner's yes (rule:standing-grants).
- **Remote mode (owner away): show, then run.** List every git / forge / outward command in order with what it does; a yes covers that set only; stop at the first failure; report each with proof (URL, SHA, state read back); read-only checks need no yes; no automated "push without asking" overrides it. What the owner must read goes as a file they can open on the phone.

## Test Integrity (Tests Never Yield to Implementation) {#test-integrity}

**NEVER compromise a test to pass the implementation.** Why: a test that always passes gives false confidence and ships green bugs.

**When a test fails (verification-first):** don't touch the test; (1) dump what the implementation produces; (2) compare to the spec's intent; (3) implementation wrong -> fix it; (4) test wrong (wrong place, outdated detail) -> fix it to the spec's intent, documented. Skipping the dump compromises the test by assumption.

**Allowed:** moving a test's LOOKUP location (assertion unchanged, output verified correct there FIRST); a spec assertion change only after a spec change locked with the owner; diagnostics; a documented platform skip only when the TEST PLATFORM lacks the API (the comment says why and where real coverage comes from). **Forbidden:** weakening an assertion; relaxing a regex; ranges wider than the spec; "close enough"; silent catches around assertions; `.skip()` on a real failure; deleting a "flaky" test without its root cause; moving a lookup unverified.

**Integrity is the line, not immutability.** Maintenance that does not lower what a test proves: (1) raising the bar (new case, tighter assertion, security coverage); (2) realigning an expected value to a LOCKED rename (matcher, strength, intent unchanged) - in a loop only when pre-listed in its contract. **Always a hard halt:** anything that would let genuinely broken behaviour pass. Why: the gap between "test passes" and "code is correct" is where low-effort products live.

## Test Value (Practical Tests, Not Test Counts) {#test-value}

**Every test names the real use or real failure it guards** - a person on a screen, a caller or agent on an API, an attacker's input, a bug that happened. No answer -> not written. Coverage and counts are signals, never goals. Why: fluff raises counts and upkeep, not confidence.

**Proof by break:** break the code the way a real bug would and show the row that turns red, on an assertion. A row no plausible bug reddens is rewritten or cut; a plausible bug no row catches gets a row.

- **Keep:** behaviour through its user's seam (screen, exported function, protocol), not private helpers; every security / privacy / legal rule and reachable failure path; boundaries, one case each side; a named regression test per real bug; table rows only for distinct branches or real inputs.
- **Cut:** tests restating the code; second proofs; assertions on freely changeable internals; rows reaching no new branch; tests passing against a do-nothing stub (unless a break-checked "nothing happens" check).
- **Checked by:** the break check; builders naming the use of any test beyond the brief; checkers' `test-value` findings (keep / cut / repoint per added or edited test); the sweep's Test Value agent; **fix forward** (cut fluff only in files a PR already touches, when cheap and safe).

