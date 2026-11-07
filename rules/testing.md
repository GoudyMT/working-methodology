---
id: testing
load: files
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "tests/**"
when: Before planning or writing tests, and when a test file is opened.
tags:
  tdd: test first, test-driven, red green, write tests
  ci-gate: ci, pipeline, checks, green
  test-and-review-cadence: when to run tests, hook, full gate, review
  sub-agent-verification: agent results, verify agent, check builder
  test-integrity: failing test, weaken, skip, assertion
  test-value: useful tests, fluff, test count, coverage
  sdd-triangle: spec, drift, adr, superseded
---

# Testing

## Test-Driven Development (TDD) {#tdd}

**Mandatory for every feature and bugfix,** presentational, config and route-shell code included: RED (a failing test for the smallest behaviour, failing for the right reason - a compiling stub, not a 404 or type error) -> GREEN (minimum code) -> REFACTOR. Never defer the testable slice; a plan note deferring a test covers only parts needing unbuilt pieces - else surface the fork to the owner. Why: a test written after the code tests the code, not the requirement.

- **Coverage targets:** pure logic - every branch a caller or bad input can reach; UI - render + interaction + state; boundaries - contract + mocked integration; critical paths - E2E.
- **Exercise failure paths:** force failure / recovery branches and assert the restore (byte-compare), not just an error printed. A feature failing at its first gate has no coverage after it - go look downstream.
- **Verify the output artifact, not just the run:** diff real input -> output and search it for every form of loss; a gate proves only the property it checks, so each property the artifact needs gets its own check. Why: a green run can ship destroyed content.
- **First, per component:** acceptance criteria as test specs, edge cases, failure modes; then tests; then code. **Fixtures look like the data** - derived from real identity rules (the id builder, the slug function) and samples (length, character set, punctuation); shared ones live in one module. Why: tidy fixtures hide the cases worth testing.
- **Separated test teams** (contract with real types -> test agent -> adversarial inspector -> implementer who cannot edit the test) are heavy: foundation logic only (crypto, codecs, state machines, ranking).
- **Layout:** tests beside source (`<source>.test.<ext>`), E2E in `tests/`. <!-- PROJECT ADAPTER A8 -->

### CI Gate {#ci-gate}

**"Green" = every step of every CI workflow file**, not a remembered subset - or name the skipped step and why. Run the FULL local gate before every PR, however small ("reasoned unaffected" is not "ran it green"); copy each command from a full read of the workflow (a folded run block is one command); the exit code is the gate - echo it, never filter output through an invented pattern; re-run the dependency audit before the PR and before merge commands. A test runner may reuse a server already on its port and test a stale build - check who owns it, never kill the owner's. Why: a remembered subset is how red mains happen. <!-- PROJECT ADAPTER A9/A10 -->

### Test and Review Cadence {#test-and-review-cadence}

Why: waiting on decisions and re-running checks cost most of a run's wall time, not the testing itself. How often, never how strict: test first, break check and the full gate before every PR never change.

- **Decide up front:** copy lines and, in a project with size budgets (rule:size-budgets), a size-raise band are settled at plan approval; one scheduled check-in per phase; a raise inside the band is not a stop.
- **Commit hook:** lint, format, type check, the whole fast suite, and only the slow (browser) tests related to staged code. Configs, workflows, the lockfile, files outside the source folders, or any deletion run everything. Prove the narrowing with a known-bad control (break a test, see red) before relying on it.
- **Full gate:** once per phase end and before every PR; independent steps run side by side, every step still runs; a fix after an Op-Test re-runs only the touched suites, the PR's final gate covers the rest; E2E may run beside the non-building steps (after type-check sync), never beside a build (shared folders and servers). **Size budgets:** once per batch; bisect only when a line is over.
- **Load guard:** the hook and the gate first run `node .claude/load-guard.cjs` (refuses CPU over 40% averaged over 3 s, naming the busiest processes; `--force` overrides). Why: a starved machine fails tests falsely.
- **Every commit runs the hook,** builder commits included. Why: a unit passing alone can break a sibling once stacked.
- **Team mode:** batch (the main session leads) under about 5 units, orchestrated above. **One review lead** runs the whole tail (sweep, fixes, fix check, op-test, design calls) with one stop.
- **Fix sets:** the fix check confirms each fix's test fails on the code before it. Why: with no re-sweep, the failing-first test is what catches a half-done fix.
- **Let CI do its job:** run targeted tests locally (the ones covering the change); CI runs the full suite and the guard proofs. Red in CI: reproduce only what failed. Why: a full local run costs minutes each time and finds what CI finds.
- **Reviewers:** a feature PR keeps the Pre-PR Deep Sweep floor; sizing to stakes applies above that floor and to other PRs. Each is held to its step limit; over is a contract miss. Keep the top model as reviewer until the scoreboard shows a cheaper one holds. **Trial (the owner, 2026-10-30):** a role other than security and the novel lens may run on the mid model (the contract's `model`, passed to its Agent call; `pre-pr-sweep/approve.mjs` refuses it on those two); every high finding is re-checked on the top model, and the outcome logs the real findings from mid-model roles (`--real-mid`). It ends when the scoreboard shows the mid model meets the bar, or on a miss.
- **Crashes:** a crash failing a step in seconds (access violation, segfault, spawn failure) is logged (date, step, what else ran), not investigated; retry once alone (no other gate, hook or agent test running); after two identical ones propose a restart. A loaded machine times out heavy tests: wait for quiet, never raise a limit.

### Sub-Agent Verification Step {#sub-agent-verification}

After GREEN on substantive logic, a fresh read-only agent sees spec + tests + implementation and hunts for overfitting. Skip for trivial changes. Why: a solo developer has no human reviewer.

```
You are independently verifying an implementation. You have no prior context.
Inputs: Spec [link] | Tests [link] | Implementation [link]
Verify: (1) ALL spec behaviours handled, or only the tested ones? (2) Edge cases the spec implies but tests
miss? (3) Ways to pass while subtly wrong (off-by-one, wrong default, silent failure)? (4) Security constraints
and _Component Security Checklist.md respected? (5) Each new test guards a real use and can fail?
Output: VERDICT PASS / FAIL / NEEDS-DISCUSSION; issues with file:line. Return findings as your final message.
Do not edit any files.
```

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

## Spec-Driven Development (SDD) Triangle {#sdd-triangle}

**Spec + tests + code stay in sync;** a change at one vertex examines the other two. Code changed -> spec updated, tests cover it? (else justify in the PR, ADR if structural). Tests changed -> did the spec require it? Spec changed -> plan the drift fix in `_Active Plan.md`. Pre-merge, source changed without spec, ADR or tests gets a why. Why: silent spec drift makes a later session re-implement the old behaviour.

**A structural decision gets an ADR: the adr skill** (MADR format from the project's template, numbered, indexed, the audit, two examples).

**Locked-Decision Drift Markers.** When code deviates from a locked ADR / spec decision, the SAME session amends every affected location (with a Revision History line), or puts `> SUPERSEDED (<date>): <what changed> - see <pointer>` at EACH one AND logs the pending sync in the plan's "Execution Notes & Deviations". The rewrite may batch, the WARNING may not; markers link forward and never delete the old prose. Why: a reader landing on a stale line will not know to read the plan addendum.
