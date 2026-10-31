# Evidence before claims

Serves step 8. If the command that proves a claim has not run in this turn, the claim is not allowed. Words like
"should", "probably", "seems" and early satisfaction ("Done!") count as claims.

## The gate

1. Name the command that proves the claim.
2. Run it in full, fresh.
3. Read all output and the exit code (echo it); count failures.
4. Does the output confirm the claim? If no, report the real state with the evidence. If yes, state the claim
   with the evidence.
5. Only then speak.

## Claim -> required proof

| Claim | Proof | Not enough |
|---|---|---|
| Tests pass | Full project test command, 0 failures, exit 0 | An earlier run, "should pass", only your own file |
| Lint or types clean | That tool's output, 0 errors | A partial check, extrapolation |
| Build succeeds | Build command exit 0 | Lint passing, logs that look fine |
| Gate green | Every step of every CI workflow (rule:ci-gate) | A remembered subset |
| Bug fixed | The reproducing test, red before the fix, green after | Code changed, assumed fixed |
| Regression test works | Red-green proof: revert the fix, test must fail, restore, test passes | One pass |
| Output file correct | Real input diffed to output, searched for loss forms | The run finished |
| Agent finished the unit | The diff or files, read by you | The agent's report of success |
| Requirements met | Re-read the plan or spec, tick each line with evidence | Tests pass |

## Scope

- A test you wrote passing is not a passing suite. Before "done", run the project's whole test command even if the
  task named one file. A task's scope bounds the deliverable, not the verification.
- Any failure that run shows, including one you did not cause, goes in the report by name. A red test left out
  falsifies the report.
- Verify before: any success wording, a commit, a PR, moving to the next task, handing work to an agent.
- Pushing, merging and releasing stay the owner's (rule:outward-acts); verification does not authorize them.

## When the check cannot run

Say so and say why (rule:anti-hallucination): "not run: <reason>; claim unverified". Never fill the gap with
confidence.
