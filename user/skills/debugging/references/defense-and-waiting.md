# Defense in depth and condition-based waiting

Used by step 10. Why: a single check is bypassed by another code path, a refactor or a mock.

## Defense in depth

After the root fix, make the bug hard to repeat by checking at the layers the bad value crosses. Map the
layers first (step 6 gave you the chain), then add checks where each earns its place:

1. **Entry:** reject clearly invalid input at the boundary (empty, missing, wrong type, a path that does not
   exist).
2. **Logic:** check the data makes sense for this operation (a required field is present).
3. **Environment guard:** refuse a dangerous act in the wrong context (a destructive call outside a temp
   directory while testing; production writes from a dev build).
4. **Forensics:** log enough context before the risky act to explain a future miss.

Test the layers: bypass layer 1 in a test and confirm layer 2 catches it. Scope this to real risk: do not
add layers where no realistic path reaches (rule:simplicity-lens). Security checks are never removed to
simplify.

## Condition-based waiting

A fixed sleep guesses at timing. It passes on a fast machine and fails under load, in CI or in parallel.

- Wait for the thing you care about: an event, a state, a count, an element, a file, a response.
- Poll the condition at a short interval (about 10 ms in-process, longer for network or disk) and ALWAYS
  with a timeout that throws an error naming what it waited for.
- Read the value inside the loop; never cache it before the loop (stale data).
- Frameworks often ship a built-in (the test library's wait-for or find-by helpers); use it before writing
  your own.

```
waitFor(condition, description, timeoutMs):
  start = now
  loop:
    result = condition()
    if result: return result
    if now - start > timeoutMs: throw "Timeout waiting for <description>"
    pause about 10 ms
```

A fixed delay is right only when you are testing time itself (debounce, throttle, a timer). Then: first wait
for the trigger condition, base the delay on a known interval (two ticks of a 100 ms timer = 200 ms), and
comment WHY.

After replacing a sleep, rerun the test many times, in parallel, to confirm the flake is gone; one green run
proves little (rule:instruments-and-evals).
