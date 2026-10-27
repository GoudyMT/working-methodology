---
name: quality-gates
description: Read before claiming "green", preparing a PR, or recommending a merge.
metadata:
  type: feedback
---

**"Green" means every step of every CI workflow file.** List all the workflow files (not just the one named "ci"), read each in full, and run every step locally - or name exactly which one you skipped and why. Why: deciding at report time what "the gates" means recurred again and again, and each time `main` went red.

- **Copy each command from a full read of the workflow**, never a grep excerpt. A folded multi-line run block is one command. When a local gate fails on an untouched file, diff your command against the workflow's, character by character.
- **The exit code is the gate, not the text.** Echo it. Never filter gate output through a pattern you invented; a tool's wording ("Code style issues found") will slip past it.
- **The pre-commit hook is a subset of CI.** Hook-green is not CI-green. Before every PR, however small, run the full gate: whole-repo lint, type check, the full E2E suite (not just touched specs), build, bundle budgets, dependency audit, static analysis.
- **"Reasoned unaffected" is not "ran it green."** "Too small for the full gate" is the same report-time decision in disguise.
- **CI-only tools are still gates.** Install and run the static analyzer locally; it takes a minute and is the exact CI command. Prefer literal forms (no regex built from a variable) so there is nothing to flag; grep new files for such constructs before the PR.
- **Config a change requires ships inside that change's PR**: budgets, CI steps, lint plugins, dependencies. A follow-up push leaves `main` red in between.
- **The dependency audit ages.** Re-run it right before opening the PR and again right before handing over the merge command. New advisories land in hours.
- **An unfixable high advisory**: confirm no patch exists, research removal first, weigh removal's risk to a working gate, else a scoped, documented ignore for that one advisory with a retire-when.
- **Never run build steps concurrently with E2E**; they share output folders and servers and produce false failures. Run build and serve gates in sequence.
- **A test runner may reuse a server already on its port** and test a stale build. Check who owns the process; never kill the owner's.
- **Verify state you were told** ("landed", "tests pass"). A commit reported as landed can be silently swept into the next one.
- **A step failing in one second is a script error** until its log says otherwise.
- **Cadence, not strictness.** Hook = related tests only; full gate once per phase and before each PR; size once per batch; a small fix set gets one combined fix check and re-sweep. See the standards, "Test and Review Cadence".

Related: [[testing-discipline]], [[git-and-pr-workflow]], [[shell-and-tooling]].
