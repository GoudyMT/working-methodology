---
name: testing-discipline
description: Read before writing, briefing or reviewing tests - test-first rules, test value, realistic fixtures, failure paths.
metadata:
  type: feedback
---

- **Strict test-first, everywhere.** Write the test, watch it fail for the right reason (a compiling stub, not a 404 or type error), write minimal code, watch the whole suite pass, then commit. No exception for "presentational", "config" or "route shell" code. Why: skipping test-first trades quality for short-term speed and lets bugs in.
- **A plan note deferring a test does not authorize untested code now.** Only the parts that depend on unbuilt pieces may wait. When tempted to skip, surface the fork to the owner; never pre-decide it.
- **Tests never yield to the implementation.** On a red test, inspect what the code actually produces first. Never weaken an assertion, relax a regex, skip, or swallow an error to get green. Raising coverage or realigning to a locked rename is fine.
- **Every test guards a real use or a real failure**, through the seam that use goes through. Cut tests that restate the code, duplicate another test, pin free internals or pad tables. No fluff to raise counts. Reviews rule keep / cut / repoint on each added or edited test.
- **Proof by break.** Each new rule gets a mutant that turns its row red. A test nobody has seen fail proves little.
- **Fixtures must look like the data.** Derive them from the real identity rule (the id builder, the slug function), never hand-written literals. Match real length, character set, digits, punctuation, multi-paragraph text. Why: a tidy colon-free fixture hid a parser that rejected every real id.
- **A feature that fails at its first gate has no coverage of anything after it.** On a gate-one defect, assume everything downstream is untested and go look.
- **Write shared fixtures once** in one module and adopt them as you touch files.
- **Force the failure paths.** A green happy-path run never touches error, partial-failure or rollback branches. Build fixtures that force each one and assert the recovery restores state (byte-compare), not just that an error printed.
- **Test the real rendered pair.** A contrast gate computes text against the composited background (tint, overlay, opacity) at the real size, not the token against the bare surface.
- **Component tests verify structure, not appearance.** A green unit test is not "visually done".
- **Separated test teams** (contract with real types -> test agent -> adversarial inspector -> isolated implementer who cannot edit the test) give robust tests but are heavy. Reserve for foundation logic: crypto, codecs, state machines, ranking math.

Related: [[verification-and-evidence]], [[findings-pipeline]], [[quality-gates]].
