---
paths:
  - "src/**"
---
<!-- Written by kit.mjs build from rules/code.md (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Code

## Code Standards {#code-standards}

Additive to the global standards, which hold comment depth, docstrings, constants and script output. Stack, naming, linters and import order live in A6/A7.

- **Size targets:** functions <= 50 lines (100 = refactor signal); UI components <= 250; files <= 500. Why: small units fit context and test easier.
- **Comments** are self-contained for a reader with ONLY the code - no plan / finding / ADR / session / task labels, no history, no restating code. Why: labels add nothing for a cold reader and cost tokens.
- **Comment out, prove, then delete:** prove suspected-dead code or data unused (type-check, tests, probe, build), then DELETE it in the same work (git keeps it; reference material moves to docs first). Only a marked placeholder or `// TODO: <what> - <why not yet>` stays. Why: a comment that makes a reader ask "what is this for?" is debt.
- **ASCII only** in every file (`->`, straight quotes, ` - `); non-ASCII built at run time from code points, never typed as an escape into a tool parameter (it may arrive decoded); every edited file scanned before commit and at closeout. Why: invisible characters break diffs, greps and absence checks.
- No magic numbers. **Match the existing pattern** for the same job (grep the invariant the codebase already enforces). **Literal patterns:** find a value by plain string search, extract with a literal regex - one built from a variable trips static analysis.
- **Embed raw, clean at display:** text both embedded / indexed and shown is cleaned only by a pure display function, never in an id, anchor or search path. Why: edits to embedded text perturb rankings.
- **Errors** throw static opaque codes (`throw new Error('E_SOMETHING')`), never interpolated input; detail goes to the safe logger. Why: input in an error is an injection and leak path. <!-- PROJECT ADAPTER A13 -->

### Size Budgets: Trim Before You Ask {#size-budgets}

Budgets are self-set so only what is necessary ships. When a change would exceed one, the order is fixed:
1. **Look for bloat first** in the over-budget bucket (dead guards, duplicated logic, values never read, eager code needed on demand), MEASURING each saving on the file it touches - even for a small overage.
2. **Prove each removal changes nothing** (the impact test): one trim per `perf:` commit through the full gate; a probe where no test can observe it; a breaking trim is reverted. **Security code is never a trim candidate:** the trim brief is an allow-list of files and functions, each trim commit diffed against it.
3. **Only then request room** with the measured shortfall, what was ruled out, and the proposed number; the owner decides. **Moving bytes between budgets is a request too.**

Never raise a limit to make a run pass. Keep a margin larger than CI's build-to-build drift. Why: a budget that bends on request is not a budget. <!-- PROJECT ADAPTER A12 -->

**One request, two checks (planned work).** A plan that grows a budget asks once, at approval: per line, the estimate + max(10%, the drift floor), landed in one commit. One final check at the PR's last gate, after review fixes: over -> steps 1-3; more room than the margin -> lower to measured + margin. A measurement above the estimate before the raise lands re-sends the request. Why: size stays a decision without a stop per commit, and padding never accumulates.
