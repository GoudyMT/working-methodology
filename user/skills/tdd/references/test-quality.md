# Test quality and anti-patterns

Serves steps 2, 3 and 7. Two principles: every test names the break it catches, and every test exercises the
real thing.

## Name the break

- Before the body, write the production change that should turn the test red. A bug qualifies. A changed
  decision (a constant, a message wording, private structure) does not.
- Derive expectations by hand. Table tests with literal expected values are the preferred shape. If the code under
  test or its helper computes the expected value, the test passes whatever the code does.
- Change detector: only an intentional redesign can fail it. Test the behaviour that depends on the decision
  (a failing call is retried 5 times and a 6th never happens), not that the constant equals 5.
- Behaviour, not text: do not assert that a script, config or doc contains a line. Run the script on controlled
  input and assert output, side effects or exit code. Prose for people needs no test.
- Your code, not the framework: test the contract at your boundary (the route you register, the query you emit,
  the payload you produce). If upstream behaviour surprised you, write one narrow test that names the assumption.
- Trivial constructors, getters, constants and forwarding earn a test only when they validate, normalize,
  default, derive, enforce or cause a side effect.

## Exercise the real thing

- A mock assertion passes when the mock exists and fails when it is gone; it says nothing about your code. Assert
  the real component; if the mock is what you check, unmock it or delete the assertion.
- Before mocking, list the real method's side effects. Mock the slow or external level below them and keep real
  what the test depends on (a config write that later logic reads).
- Make doubles specific. If arguments, call counts or order are part of the contract, assert them. Give each
  branch (success, error, malformed) its own fixture so the wrong branch cannot satisfy the test.
- Mirror real data completely: every documented field, not only those the test reads. A partial mock passes while
  integration breaks.
- Production classes carry production methods. Cleanup that only tests call lives in test utilities.
- Mock setup larger than half the test, or mocks that miss real methods -> switch to an integration test with real
  parts. "Must mock everything" signals tight coupling; inject the dependency.

## Gates (ask before writing)

1. Can I name the change that fails this? If not, redesign around an observable behaviour.
2. Is the expected value independent of the code under test?
3. About to add a mock? Which side effects does the real thing have, and which does the test need?
4. About to assert on a mock? Unmock it or drop the assertion.

## Warning signs

Setup and assertion share one object; the test can fail only by a crash or missing selector; it fails on every
intentional change and never on accidental breakage; expected values hide behind loops or builders; it exists for
coverage and checks no outcome; a `*-mock` test id is asserted; a method is called only from tests.

## When stuck

| Problem | Move |
|---|---|
| Do not know how to test it | Write the call you wish existed, then the assertion, then the stub |
| Test is complicated | The interface is complicated; simplify it |
| Setup is huge | Extract helpers; if still big, simplify the design |
| Hard to test | Hard to use; change the design |

## Rationalizations that all mean "write the test first"

"Too simple to test", "I will add tests after" (they pass at once and prove nothing), "I tested it by hand"
(no record, cannot rerun), "deleting this code wastes the hours" (the hours are spent either way), "this is
different". Exploration is fine; throw it away and start with the test.
