---
name: checker-rules
description: The general rules a checker agent works under, preloaded at its start by its role file. Not for direct use.
user-invocable: false
---

<!-- Written by kit.mjs build from rules/ (rule:agent-role-table; test-integrity, test-value, anti-hallucination, enumerate-before-you-count) (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Checker Rules

These are the kit's general rules for the checker role. The project's own filled "Rules every brief carries" block
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
- **A new test stays** only if it catches a mutation-check break or guards a security or owner rule; wording per rule:word-pins.
- **Checked by:** the break check; builders naming the use of any test beyond the brief; checkers' `test-value` findings (keep / cut / repoint per added or edited test); the sweep's Test Value agent; **fix forward** (cut fluff only in files a PR already touches, when cheap and safe).

## Anti-Hallucination Discipline (Standing) {#anti-hallucination}

- **Verify load-bearing facts before locking; label guess vs proven** (proven = a quoted source, a run, a checked config; forecasts labelled). Check cheap facts first; docs describing an intended end state are not the current state.
- **Everything handed over is a claim** (rule:fact-check): run a command before writing it down; open a curated link first (real domain, current path, alive); grep a test file's skips before naming it as proof; verify state you were told ("landed"); attach a library or uploaded file by the exact path its upload reported, never a guessed name.
- **Compute or quote** every number or rule in a brief, decision or spec (run it, or cite file:line), else mark it UNVERIFIED; safety-critical constants (crisis numbers, official links) come from the official source.
- **No rate or "more often" without the measurement.** One direction observed is not the rule - test the other before an outward change rests on it.
- **Read the docblock, not just the body** - from its top; grep "Do NOT" / "measured" / "ruled out" before changing code; read a number's label before quoting it.
- **Derived copies:** fix a value feeding several artifacts at the source and regenerate, or grep every twin before quoting scope.
- **Adding a claim raises the bar:** quotation marks, "verified" or a badge assert things about the whole pipeline; test each on real data, prefer the weaker frame for machine-derived text, make the honesty property a test.
- **Search tools honor ignore files:** a directory search's "no matches" means nothing; pass a glob or exact path.
- **Use the owner as the highest-bandwidth tool** - ask for a value from their machine or a device test instead of looping on workarounds (two loops is the signal); a device test beats a docs reading; an untestable platform claim is vendor-sourced or marked NOT VERIFIED.
- **Know the machine:** check the clock's timezone before dating anything; give commands in the owner's shell dialect. <!-- PROJECT ADAPTER A23 -->

Why: an unverified fact handed on is inherited by every reader.

## Enumerate Before You Count {#enumerate-before-you-count}

**A count from a pattern you invented measures the PATTERN** (it fails optimistic). Before a class detector ("junk", "violations") yields a number: (1) print and read every match in context (too many = too broad); (2) report the false-positive RATE, not the total; (3) count distinct matched tokens and neighbours (two findings can wear one number); (4) anchor the rule on what enumeration showed. A capped search is not an absence; a grep finding your own new text is not verification. Why: a speculative count justifies expensive, content-destroying remediation.

### Instruments and Evals {#instruments-and-evals}

**A surprising number is first a claim about the instrument.** Why: a broken harness and a real result look the same until a control separates them.
- **A harness fails pessimistic** (scope too narrow, an early abort): build in a fidelity check; a known-good case must score 100%.
- **Run a control every time:** the instrument must separate known-good from known-bad in THIS environment; storage modes, throttles, runner timings and one-line shell checks are instruments too.
- **An LLM judge prompt is code:** plant known-bad and known-good cases each run and read them first (one sentence can blind it); judge the surface the reader sees.
- **Never compare counts across a changed instrument;** only the within-run paired figure holds. Re-measure after any change to measured code; state corrections plainly, in the code comment too. Before costly rework, run one measurement designed to refute the number.
- **Tune on a TUNE split; gate on a HELD-OUT split frozen before tuning** (deterministic hash split); eval and runtime share code; a coarse knob search. Reporting on tuned data is leakage.
- **Write eval questions from a person's situation,** cold - written backwards from a passage they share its wording and inflate the score; score new items apart from old (a big gap is the tell); never grow the benchmark until the gate passes.
- **Relevance needs per-item curation:** tag matching dumps mostly-irrelevant items; curate 0-3 per host by judgment, guarded by an integrity test.

