---
name: test-reviewer-rules
description: The general rules a test-reviewer agent works under, preloaded at its start by its role file. Not for direct use.
user-invocable: false
---

<!-- Written by kit.mjs build from rules/ (rule:agent-role-table; test-integrity, test-value) (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Test-reviewer Rules

These are the kit's general rules for the test-reviewer role. The project's own filled "Rules every brief carries" block
(rule:agent-team-adapter, named in your brief) adds the project's values and wins where it differs.

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
- **A new test stays** only if it fails first and catches a mutant or guards a security / owner rule.
- **Checked by:** the break check; builders naming the use of any test beyond the brief; checkers' `test-value` findings (keep / cut / repoint per added or edited test); the sweep's Test Value agent; **fix forward** (cut fluff only in files a PR already touches, when cheap and safe).

