---
name: outward-writing
description: Read before drafting a PR body, release notes, README, public docs or a post the owner publishes.
metadata:
  type: feedback
---

**Start every outward piece from its format.** Before the first sentence: name its kind, read its template, the written rule, and two lived pieces of the same kind, then draft, then run its audit and show the result with the piece. List the sources read in the hand-off. Why: each format took many corrections to settle; drafting from memory reopened them every time.

**PR bodies**
- **Size follows the PR.** Small PRs (docs, chore, test, dependency bump) get a lean body: about 180 words, a few changes (what + why, never a file list), three gates, notes one sentence. Large PRs get the large form: a before/after table on screen, file lists and gate figures in collapsed folds, a word cap on screen and in total. Never inflate a small one.
- **Pick the lived example by matching kind and change**, then carry over its content conventions (a budget raise names old -> new and its basis; a proof gate gives counts and claims only what ran).
- **Describe reviews by dimension and verdict**, never by mechanism (no agent, swarm or method words). No links to private or ignored docs; summarize inline. ASCII only.
- **H1 equals the title**, a feature area plus one line, no type prefix.
- **Make the audit a script** with fixed rows (sections, width, word caps, banned words, ASCII). Even then, compare against two lived bodies; a form audit cannot see content drift.
- **After any trim, reread the whole body for flow.** One name per actor, full sentences, no word echo. If flow costs words, ask before cutting detail.
- **"Wall of text" means measure on-screen words and bullet length**, not the total.

**Release notes**
- **Match the latest release of the same kind** (feature vs quality).
- **Describe the change from the last release**, not from mid-branch states that never shipped.
- **Per-claim audit before showing**: each claim -> the file, test or measurement that proves it. A "used to" claim names only states a person could reach. A claim about a third-party app's behavior needs a measurement per app.
- **Plain and outward-facing**: non-technical readers; tests, tooling and dependency bumps stay out.

**Public prose the owner publishes as themself** is dash-free (no em dash, no double hyphen) and avoids other AI tells (neat triads, stock phrases). Lead with value, not the last post's pattern. Check every date against the record.

Related: [[git-and-pr-workflow]], [[release-and-deploy]], [[communication-style]].
