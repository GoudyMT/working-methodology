# Trace and instrument

Used by steps 5 and 6. Why: the place a bug shows is rarely the place it starts.

## Backward tracing

1. Write the symptom exactly (the error text, the wrong value, where it appeared).
2. Find the line that directly causes it.
3. Ask: what called this, and with which value? Move up one frame. Repeat until the value is created.
4. At each frame note the value on the way in. The first frame where it is already wrong is one step too far
   up; the frame that made it wrong is the source.
5. Fix at the source. Then consider guards on the frames between (see defense-and-waiting.md).

Worked shape: a command ran in the wrong directory. Its cwd argument was an empty string, and an empty cwd
means "current directory". The empty string came from a test helper read before its setup hook ran. Root
cause: a value read too early, not the command. The fix made the early read throw.

## Instrumenting a multi-part system

Do it once, before any fix, for every boundary (CI -> build -> sign, API -> service -> store, UI -> worker):

- Log what enters and what leaves each part.
- Log whether config, env vars and secrets arrive (SET or UNSET only; never print a secret).
- Log state at each layer (versions, paths, flags).
- Read the one run, find the first boundary where the data goes wrong, then go deep only there.

## Instrumentation habits

- Log BEFORE the risky call, not after it fails; include the inputs, the working directory, the environment
  name, a timestamp.
- Capture a stack at the call site when the caller is unknown (`new Error().stack` in JS,
  `traceback.format_stack()` in Python).
- In tests write to stderr, not through a logger that may be silenced.
- Send output to a file and search it; do not eyeball long runs.
- Strip the instrumentation after, or keep it as a quiet permanent log if it earns its place.

## Test pollution by bisection

When a test leaves something behind (a file, a directory, global state) and you do not know which test:
run the tests one at a time (or in halves) and check for the artifact after each; stop at the first that
creates it. Then trace that test backward as above.

## Intermittent failures

Record each failure with its conditions (load, order, machine, time). Run the test in a loop and in parallel
to raise the rate. Two causes cover most cases: shared state between tests, and timing guesses. For the second
see defense-and-waiting.md.
