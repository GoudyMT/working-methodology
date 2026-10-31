---
name: tdd
description: Build any behaviour test-first (red, green, refactor, watch each test fail first) and check evidence before claiming anything is done, fixed or passing. Use when implementing a feature or bugfix, writing or changing tests, choosing what to test at which layer, adding a mock, or about to say "done", "fixed", "passing" or open a PR.
---

# TDD and Evidence Before Claims

Serves rule:tdd, rule:test-integrity and rule:test-value (testing rules). Read them first. They set the bar:
mandatory for every feature and bugfix, a failing test never gets weakened, every test guards a real use. This
skill adds the method. It never restates those rules. For a failing test or a surprising number,
rule:failure-response leads.

## When it applies

- You are about to write behaviour: a feature, a bugfix, a behaviour change, a risky refactor.
- You are writing, editing or reviewing a test, or about to add a mock.
- You are about to claim work is done, fixed or passing, to commit, or to open a PR.

Why: a test written after the code tests the code, and a claim made without a fresh run is a guess.

## Steps

### 1. Pick the layer and the first test
Decide which layer proves the behaviour (pure logic, boundary, UI, end to end) from
[references/test-layers.md](references/test-layers.md). Write the acceptance criteria as test names first.
Done when: each criterion has a layer and a one-line name that states a behaviour.

### 2. Name the break (before the test body)
Answer: what production change would make this test fail, and is that change a bug or only a decision?
Cannot name a bug -> the test is a change detector; aim at the behaviour that depends on the decision. Derive
the expected value by hand (a literal), never from the code under test. See
[references/test-quality.md](references/test-quality.md).
Done when: the break is written in one line (in the plan or a comment) and the expected value is a literal.

### 3. RED: write one test, watch it fail
One behaviour per test, real code, no mock unless the real thing is slow or external. Run it. It must FAIL (not
error) for the right reason: the feature is missing, not a typo, a 404 or a type error. Use a compiling stub so
the failure is an assertion. Read the failure message.
- Passes at once -> it tests existing behaviour; fix the test.
- Errors -> fix the error, rerun until it fails correctly.
Done when: you have seen the red line and its message matches the missing behaviour.

### 4. GREEN: the least code
Write the simplest code that passes. No options, no extra features, no "while I am here". Run the test, then the
project's whole test command. A failing sibling test is yours to fix now. A failure you did not cause still goes
in your report by name. When a test fails, rule:test-integrity applies: dump what the code makes, compare to the
spec, fix the code first.
Done when: the new test and the full suite pass, and the output has no warnings or stray errors.

### 5. REFACTOR, then repeat
With green only: remove duplication, improve names, extract helpers. Add no behaviour. Rerun after each change.
Then the next failing test. Code written before its test: set it aside, write the test, watch it fail, rewrite
the code from the test. Keeping it "as reference" is writing tests after.
Done when: the suite is still green and no step added behaviour.

### 6. Bugs: reproduce first
A bug gets a failing test that reproduces it, named for the bug, before any fix. The same test then proves the fix
and guards against return. If you cannot reproduce it, get data first (rule:failure-response); do not guess a fix.
Done when: the test failed before the fix and passes after.

### 7. Break check and review
Mutate the code as a real bug would (wrong constant, wrong branch, missing side effect, empty return, missing
validation for empty, zero or malformed input) and show the test that turns red. A plausible break nothing catches
gets a test; a test no plausible break reddens is cut (rule:test-value). Substantive logic also gets the
sub-agent verification in the testing rules.
Done when: each realistic mutation has a red row, named.

### 8. Verify before you claim
Before any word that says done, fixed, passing, clean or ready: run the command that proves it, in full, in this
turn, read all the output and the exit code, then state the claim with the evidence. Use
[references/verification.md](references/verification.md) for the claim -> proof table. "Green" means every step of
CI, per rule:ci-gate. Report agent output only after you check the diff or the files yourself.
Done when: each claim in your report names the command run and its result.

## Anti-patterns (full list in references/test-quality.md)

Tautology (the code builds both sides), asserting on a mock, change detectors, grepping source text for a line,
testing the framework, test-only methods in production classes, setup bigger than the assertion.

## Rules this skill never overrides

- A failing test is never weakened, skipped or relaxed to pass (rule:test-integrity).
- No test exists to raise a count (rule:test-value).
- Local commits are fine in a loop; push, PR and merge stay the owner's (rule:outward-acts).
- Skipping TDD is not a call to make: surface a real fork to the owner (rule:tdd).
