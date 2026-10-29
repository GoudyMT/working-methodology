---
id: git-and-release
load: files
paths:
  - ".github/**"
  - "CHANGELOG.md"
when: Before a commit, branch, PR, merge or release.
tags:
  pre-commit: before commit, commit checks, staged
  commit-message-format: commit message, subject line, type
  branching: branch name, naming, git branch
  pr-body: pull request description, pr text, body
  release-notes: release, changelog, version notes
  post-merge-check: after merge, deploy check, live
  kit-stays-local: kit not committed, exclude, track growth, never list, private
  first-push-gate: first push, new remote, initial push, tracked files check, history
---

# Git and Release

## Pre-Commit Discipline {#pre-commit}

Every commit passes the hook (-> rule:test-and-review-cadence). **Never `--no-verify`.** One commit per call, foreground, never parallel, output unfiltered to a log; preview servers and test browsers stopped first. After a failure or a killed hook, check the half-state (status, log, stash list, index lock, leftover test processes) before a retry; never chain a commit after a failed one. Why: chained commands run on whatever the failure left staged. <!-- PROJECT ADAPTER A9/A15 -->

### Commit Message Format {#commit-message-format}

One line: `git commit -m "fix: hold the page still behind the open reader"`.
- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`, `perf`; a scope is optional and rare.
- **Subject:** imperative, lowercase, no period, what the change does for a `git log` reader; no task / phase tags or asides. **No body, footer or AI / tool trailer** (detail goes in the PR body, the Session Log and comments). Reaching for `-F`, a heredoc or a second `-m` means the message is already wrong.
- **Check first:** `git log --format=%s -20`; if this section and the log disagree, the log wins and this section is fixed. Why: a documented convention nobody practises misleads every new agent.
- **Enforced** by a `commit-msg` hook + a CI check over the branch's commits. <!-- PROJECT ADAPTER A15 -->

## Branching {#branching}

`main` always shippable; short-lived branches (1-3 days); squash-merge; linear history; PRs for anything non-trivial (review pause + CI).

**Branch names:** `<type>/<plain-kebab-description>` (`feature`, `fix`, `chore`, `test`, `perf`, `security`) in plain words; no internal codes or tool prefixes (`claude/`, `worktree-`); read recent PR branch names first. Why: a branch name is public, like a commit subject.

**Branch-first:** before the FIRST edit to a tracked file for a feature, be on its branch (vault edits exempt), the isolation tier named: a trivial fix may land on `main` where the project allows; a feature gets a branch; major work a worktree. Re-check `git branch --show-current` before committing. **Highest risk: right after a merge** - branching is the first action of any new issue; the tell is proposing a PR from `main`. Why: branching tied to a later step is skipped by work that comes first.

**Retire merged branches, local and remote:** a squash-merged branch looks unmerged (a "gone" upstream is the tell) - confirm an empty `git diff --stat <branch> main`, then force-delete; unset the upstream of a branch deleted remotely on purpose.

## PR Body Standard {#pr-body}

Formats in `_Templates/_PR Body Template.md`: **Standard** for features, design decisions and new behaviour; **Lean** for chores, docs, config, bumps and one-line non-behavioural changes.

**How: the pr-body skill** (steps, two examples, the audit run).

- **Hard rules (outward-facing):** ASCII; no AI / agent / tool references (reviews described BY DIMENSION + verdict); no links to gitignored vault docs; value-led title `<Area>: <line>`, H1 = the title.
- **Lean:** 1-2 sentence framing, <= 3 changes (what and why, no file lists), 3 gates (the proof; the full gate as one line; the sweep tier and its result by dimension, rule:sweep-tiers), <= 1 sentence of notes.
- **Summary, not tallies:** outward summaries state the end result, and each thing once. No per-step tallies (size raises, finding, test or mutant counts); keep a number only if it is the result or the reader acts on it. Test each line: who reads it, and why care? Detail stays in the sweep report and plan. Why: tallies bury the result.
- **Standard:** before / after table; decisions and review result on screen; file list, gate results and clean checks in folds; total, on-screen and per-bullet ceilings ("wall of text" = on-screen words and bullet length); plain engineer speak.
- **Never inflate a small PR.** The audit script (sections, width, word caps, banned words, ASCII) runs with every body; it cannot see content drift, so keep the conventions of the lived bodies (below; a budget raise states the final old -> new and its basis; a proof gate claims only what ran). Body + audit go to the owner BEFORE any push or PR command. After a trim, reread for flow. <!-- PROJECT ADAPTER A16 -->

**Every outward piece starts from its format:** a PR body, release notes, doc, README or post starts from its template, its rule and the two latest pieces of its kind, and runs its audit; the hand-off names the sources. Prose the owner publishes as themselves avoids AI tells: dash-free (no em dash, no double hyphen), no neat triads or stock phrases. Why: writing from memory drifts the format a little every time.

## Release Notes {#release-notes}

**After every merge that changes what users get, a release follows** the Post-Merge Check.
**How: the release-notes skill** (steps, two examples, the audit).
- **Match the latest release of the same kind** (feature vs quality) - read it first. <!-- PROJECT ADAPTER A17 -->
- **Lead with this release's value**, not the last post's pattern; describe the change from the last release, not unshipped mid-branch states; check every date.
- **Semver:** patch = fixes; minor = new user-facing features; major = breaking; state the reasoning against the version plan (roadmap labels are names, not tags); ask when a run's mix is unclear. One release may cover two same-day merges.
- **Public prose:** plain words - what a user gets, honest limits beside the claims they limit; no tests, tooling, bumps, AI references or vault links (summary, not tallies); each claim audited to the file, test or measurement proving it (a "used to" claim names only states a person could reach; a third-party app claim needs a measurement per app).
- **The owner publishes or approves each publish;** Claude drafts and publishes only on an explicit go. A post accompanies a feature release only, when the owner says so.
- **The work PR carries the version bump** - never a bump-only PR; with several PRs the last to merge carries it; held while the merge date is unknown. The shown version comes from the package file; the audit checks tag == package version.
- **Tag the full SHA CI tested,** never a branch or short SHA. List releases before creating (an existing tag: compare its body with the audited draft); after publishing, read the live body back and diff it.

Why: a release is a public claim, drafted from format and code and published only by the owner.

## Post-Merge Check {#post-merge-check}

After every merge, before the release, verify the live system, each step shown: (1) **the deploy landed** - the live build identifier postdates the merge; (2) **the critical path answers** - one real request returns the expected status and version; (3) **a mismatch is an outage** - tell the owner at once, run the runbook. Retire it when CI does it. Why: hand-deployed parts drift from merge-deployed parts silently. <!-- PROJECT ADAPTER A18 -->

**Deploy config:** a hand-deployed part (a data index, a side service) needs its own upload and redeploy on each version change - write the runbook. A dashboard-only change to a config-file setting drifts back on the next deploy: durable changes go in the config file, secrets in the platform's secret store. Before a hand deploy, diff local config against committed, ids masked. Never roll back past a local-database schema raise (older code cannot open it); fix forward.

## Kit Stays Local {#kit-stays-local}

The kit lives in the working folder, ready to use and continue, and never in the repo by default. The install lists every kit path in a marked block of `.git/info/exclude`, which is never pushed, so even the list stays private. To show growth, the owner names chosen files in `.kit/tracking.json` `track` and adds each on purpose with `git add -f`; `never` names more paths that must never be committed (course or client material, private notes). Committing the whole kit (`"kit": "tracked"`) is the owner's explicit choice, for a private repo only. Why: the kit and the owner's notes are private working material; a public repo keeps every commit forever.

## First Push Gate {#first-push-gate}

Before the first push to a new remote, run the strictest check once: `node .claude/first-push-check.mjs`, with the deep sweep (rule:sweep-tiers, first push). It fails on a kit path, a `never` path, or a secret-shaped file or value in ANY commit, a deleted one included, and on a `track` file that is not tracked; it lists untracked files to decide. The owner reviews `git ls-files` against the plan. A history hit means rewriting history or a fresh repo before the push, never "delete it in the next commit". On a pass it records the commit; the pre-push hook lets only that commit go first, for any pusher. Why: the first push sets the foundation; what it carries is public for good.
