# What to test at which layer

Serves step 1. The pyramid: many fast unit tests, some integration tests, few slow end-to-end tests. Push each
check to the lowest layer that can still fail for the real reason.

## Layer by kind of code

| Code | Lowest layer that proves it | Add above it |
|---|---|---|
| Pure logic (parsers, ranking, codecs, state machines) | Unit: every branch a caller or bad input can reach | none |
| Data pipeline step (ML or content) | Unit on the transform with a small real-shaped sample: input validation, correctness, idempotency (run twice, same result) | one check on the real output artifact |
| API or HTTP boundary | Integration on the route: status, payload shape, auth failure, malformed body | contract test if other code consumes it |
| UI component | Render + interaction + state, through roles and labels a user sees | accessibility check; visual check only when the look is the feature |
| Storage, crypto, protocol | Unit with real types, plus a failure path that asserts the restore | the heavier separated-team process only for foundation logic |
| Critical user path | End to end, one per path | none |
| Infrastructure | Smoke test that it starts and answers | load test when a limit is promised |

## What to cover

Business-critical paths, error and refusal paths, boundaries (one case each side of the line), security and
privacy rules, data integrity. Skip: trivial getters, framework behaviour, one-off scripts, prose for people.

## Failure paths are first-class

Force the failure and the recovery, then assert the restored state (compare bytes or values), not just that an
error printed. A feature that fails at its first gate has no coverage after it; test downstream too.

## Artifact check

When code produces a file or dataset, diff real input against real output and search the output for each way it
could lose content. A passing run proves only the property its checks look at.

## Test plan shape (when asked for a plan)

For each area: what to test, the layer, the criterion it guards, two or three concrete cases, and the gaps in the
current coverage. No coverage percentage as a goal (rule:test-value).

## Fixtures

Build them from the real identity rules (the id builder, the slug function) and from samples with real length,
characters and punctuation. Keep shared fixtures in one module. A tidy fixture hides the cases worth testing.
