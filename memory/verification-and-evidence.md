---
name: verification-and-evidence
description: Read before stating a fact, locking a recommendation, quoting a number or claiming a fix works.
metadata:
  type: feedback
---

- **Label guess vs proven.** Proven = a quoted source, a run, a checked config. Guess = say so ("not verified; this assumes Y"). Why: a confident recommendation on an unchecked assumption cost a full build and CI cycle.
- **Check the cheap facts first** (one API call, one doc read, one config read). Docs that describe an intended end state are not the current state.
- **Everything you hand over is a claim.** Curl a link before sending it. Grep a test file's skips before naming it as proof. Count a number from the code before it goes in prose. Read the machine's time zone before stating a time. Say what was checked.
- **Report what was observed; label forecasts.** "Not loaded yet (observed); docs say a restart may be needed (unverified)."
- **One direction observed is not the rule.** Test the other direction before an outward change rests on it.
- **Get data before fixing.** When a bug is not observable, instrument it (a temporary on-screen readout, a log) before touching the fix. Two blind fixes in a row is the signal to stop and measure. Strip the debug after.
- **Verify the output artifact, not just the run.** A green pipeline and a passing metric can still ship destroyed content. Diff real input -> output and grep the shipped artifact for every loss and junk form.
- **A gate proves only the property it checks.** List every property the artifact needs and give each its own check.
- **Derived copies:** when a value feeds several artifacts, fix it at the source and regenerate, or grep the whole repo for every twin before quoting scope.
- **Adding a claim raises the bar.** Quotation marks, "verified", a badge assert things about the whole pipeline behind them. Enumerate each claim and test it on real data; prefer the weaker frame for machine-derived text; write the honesty property as a test.
- **Read the docblock, not just the body.** Grep a file for "Do NOT", "measured", "ruled out" before proposing a change. Start a read at the top of the docblock. Read a number's label before quoting it.
- **Search tools honor ignore files.** A "no matches" from a directory search that skips ignored files means nothing; pass a glob or an exact path.
- **Web-verify curated external links**: the real domain, the current path, still alive.
- **Device claims need the device.** A claim about a platform you cannot test is sourced from its vendor or marked NOT VERIFIED. A device test beats a docs reading.

Related: [[measurement-and-evals]], [[testing-discipline]], [[findings-pipeline]].
