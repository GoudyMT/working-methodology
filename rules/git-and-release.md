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

**How: the pr-body skill** (its steps, the full rule, two examples, the audit). The must-haves: ASCII, no AI references, a value-led title, and the body with its audit shown to the owner before any push or PR command. <!-- PROJECT ADAPTER A16 -->

**Every outward piece starts from its format:** a PR body, release notes, doc, README or post starts from its template, its rule and the two latest pieces of its kind, and runs its audit; the hand-off names the sources. Prose the owner publishes as themselves avoids AI tells: dash-free (no em dash, no double hyphen), no neat triads or stock phrases. Why: writing from memory drifts the format a little every time.

## Release Notes {#release-notes}

**After every merge that changes what users get, a release follows** the Post-Merge Check.

**How: the release-notes skill** (its steps, the full rule, two examples, the audit). The must-haves: the owner publishes or approves each publish, every claim is audited to its proof, and the tag is the full SHA CI tested. <!-- PROJECT ADAPTER A17 -->

Why: a release is a public claim, drafted from format and code and published only by the owner.

## Post-Merge Check {#post-merge-check}

After every merge, before the release, verify the live system, each step shown: (1) **the deploy landed** - the live build identifier postdates the merge; (2) **the critical path answers** - one real request returns the expected status and version; (3) **a mismatch is an outage** - tell the owner at once, run the runbook. Retire it when CI does it. Why: hand-deployed parts drift from merge-deployed parts silently. <!-- PROJECT ADAPTER A18 -->

**Deploy config:** a hand-deployed part (a data index, a side service) needs its own upload and redeploy on each version change - write the runbook. A dashboard-only change to a config-file setting drifts back on the next deploy: durable changes go in the config file, secrets in the platform's secret store. Before a hand deploy, diff local config against committed, ids masked. Never roll back past a local-database schema raise (older code cannot open it); fix forward.
