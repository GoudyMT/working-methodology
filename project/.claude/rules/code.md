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
- **Surgical changes:** match the surrounding code's style (naming, layout, idiom), even where you would write it differently; remove what your own change left unused (imports, variables, helpers) in the same commit; dead code that was there before follows "Comment out, prove, then delete". Why: a diff that carries only the request is one a reviewer can trust.
- **ASCII only** in every file (`->`, straight quotes, ` - `); non-ASCII built at run time from code points, never typed as an escape into a tool parameter (it may arrive decoded); every edited file scanned before commit and at closeout. Why: invisible characters break diffs, greps and absence checks.
- No magic numbers. **Match the existing pattern** for the same job (grep the invariant the codebase already enforces). **Literal patterns:** find a value by plain string search, extract with a literal regex - one built from a variable trips static analysis.
- **Embed raw, clean at display:** text both embedded / indexed and shown is cleaned only by a pure display function, never in an id, anchor or search path. Why: edits to embedded text perturb rankings.
- **Errors** throw static opaque codes (`throw new Error('E_SOMETHING')`), never interpolated input; detail goes to the safe logger. Why: input in an error is an injection and leak path. <!-- PROJECT ADAPTER A13 -->

### Size Budgets: Trim Before You Ask {#size-budgets}

**Opt-in per project:** this rule and the size-raise band (rule:test-and-review-cadence) apply only where the project adapter's A12 row names budgets, a choice made when the kit is first applied to a new or existing project. A12 set to `none` turns both off. Why: budgets fit a project that ships to slow phones or has a hard size limit, not every project.

Budgets are self-set so only what is necessary ships. When a change would exceed one, the order is fixed:
1. **Look for bloat first** in the over-budget bucket (dead guards, duplicated logic, values never read, eager code needed on demand), MEASURING each saving on the file it touches - even for a small overage.
2. **Prove each removal changes nothing** (the impact test): one trim per `perf:` commit through the full gate; a probe where no test can observe it; a breaking trim is reverted. **Security code is never a trim candidate:** the trim brief is an allow-list of files and functions, each trim commit diffed against it.
3. **Only then request room** with the measured shortfall, what was ruled out, and the proposed number; the owner decides. **Moving bytes between budgets is a request too.**

**Asking for room (the size band):**
- **One request per plan, from a measurement.** Build a first version, measure, then ask once per line at plan approval: the measured growth plus a margin of 10% of it. Never ask from an estimate; a count line (files, not bytes) is asked exactly.
- **Measure the same way every time.** Measuring builds use one fixed version and build stamp, so the same code gives the same bytes and no room is kept for noise. Where a build cannot be made deterministic, A12 names a drift margin taken from measured runs.
- **Only a measured size past what is allowed is an ask.** Allowed = the limit at approval plus the approved raise, or the current limit for a line the plan did not list. The margin is headroom: written when it fits, dropped when it does not, never a reason to ask. A line under its limit and not in the plan is left alone. Every byte truly past the band is a re-request, after a trim pass.
- **End check at the PR's final gate:** a line over its limit goes back to steps 1-3; a line the plan raised that has more room than its margin is lowered to its size plus the margin.
- **By script, never by hand:** `node .claude/size-band.mjs apply|final` does the arithmetic from the band, the measured sizes and the current limits (A12 names the measure command and where the limits live); the new limits land in their own `chore:` commit with the reason recorded.

Never raise a limit to make a run pass. Why: a budget that bends on request is not a budget, and an ask the rule did not mean teaches people to wave asks through. <!-- PROJECT ADAPTER A12 -->

