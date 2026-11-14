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
  standing-grants: grant, autonomy, autopilot, kill switch, act without asking, automatic release
---

# Git and Release

## Pre-Commit Discipline {#pre-commit}

Every commit passes the hook (-> rule:test-and-review-cadence). **Never `--no-verify`.** One commit per call, foreground, never parallel, output unfiltered to a log; preview servers and test browsers stopped first. After a failure or a killed hook, check the half-state (status, log, stash list, index lock, leftover test processes) before a retry; never chain a commit after a failed one. Why: chained commands run on whatever the failure left staged. <!-- PROJECT ADAPTER A9/A15 -->

### Commit Message Format {#commit-message-format}

One line: `git commit -m "fix: hold the page still behind the open reader"`.
- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`, `perf`; a scope is optional and rare.
- **Subject:** <= 72 characters, one change; imperative, lowercase, no period, what the change does for a `git log` reader; no task / phase tags or asides. **No body, footer or AI / tool trailer** (detail goes in the PR body, the Session Log and comments). Reaching for `-F`, a heredoc or a second `-m` means the message is already wrong.
- **Checked by script:** the commit-msg hook and CI run `.claude/name-check.mjs` on every message; a refusal is fixed in the message, and a style the check gets wrong is fixed in the check. Why: a documented convention nobody practises misleads every new agent.
- **Enforced** by a `commit-msg` hook + a CI check over the branch's commits. <!-- PROJECT ADAPTER A15 -->

## Branching {#branching}

`main` always shippable; short-lived branches (1-3 days); squash-merge; linear history; PRs for anything non-trivial (review pause + CI).

**Branch names:** `<type>/<plain-kebab-description>` (`feature`, `fix`, `chore`, `test`, `perf`, `security`) in plain words; no internal codes or tool prefixes (`claude/`, `worktree-`). The pre-push hook and CI check each branch (`.claude/name-check.mjs`). Why: a branch name is public, like a commit subject.

**Branch-first:** before the FIRST edit to a tracked file for a feature, be on its branch (vault edits exempt), the isolation tier named: a trivial fix may land on `main` where the project allows; a feature gets a branch; major work a worktree. Re-check `git branch --show-current` before committing. **Highest risk: right after a merge** - branching is the first action of any new issue; the tell is proposing a PR from `main`. Why: branching tied to a later step is skipped by work that comes first.

**Retire merged branches, local and remote:** a squash-merged branch looks unmerged (a "gone" upstream is the tell) - confirm an empty `git diff --stat <branch> main`, then force-delete; unset the upstream of a branch deleted remotely on purpose.

## PR Body Standard {#pr-body}

Formats in `_Templates/_PR Body Template.md`: **Standard** for features, design decisions and new behaviour; **Lean** for chores, docs, config, bumps and one-line non-behavioural changes.

**How: the pr-body skill** (steps, two examples, the audit run).

- **Hard rules (outward-facing):** ASCII; no AI / agent / tool references (reviews described BY DIMENSION + verdict); no links to gitignored vault docs; title `type: subject` (squash subject + " (#n)" <= 72, CI checks), H1 `<Area>: <line>` ending in it.
- **Lean:** 1-2 sentence framing, <= 3 changes (what and why, no file lists), 3 gates (the proof; the full gate as one line; the sweep tier and its result by dimension, rule:sweep-tiers), <= 1 sentence of notes.
- **Summary, not tallies:** outward summaries state the end result, and each thing once. No per-step tallies (size raises, finding, test or mutant counts); keep a number only if it is the result or the reader acts on it. Test each line: who reads it, and why care? Detail stays in the sweep report and plan. Why: tallies bury the result.
- **Standard:** before / after table; decisions and review result on screen; review rows are the project's (A16), files and gates left to GitHub; word and bullet ceilings; plain speak.
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
- **The work PR carries the version bump** - never a bump-only PR; with several PRs the last to merge carries it; the bump is on the branch before the PR opens. The shown version comes from the package file; the audit checks tag == package version. Both PR-body audits fail shipped code with no bump unless the body says "No user-facing change" (`version-bump-check.mjs`; shipped paths in `.kit/version-bump.json`).
- **Tag the full SHA CI tested,** never a branch or short SHA. List releases before creating (an existing tag: compare its body with the audited draft); after publishing, read the live body back, diff it and audit it as published: `node ~/.claude/kit-tools/merge-gate.mjs live release <tag>` (`$HOME` in PowerShell; a PR body: `live pr <n>`).

Why: a release is a public claim, drafted from format and code and published only by the owner.

## Post-Merge Check {#post-merge-check}

After every merge, before the release, verify the live system, each step shown: (1) **the deploy landed** - the live build identifier postdates the merge; (2) **the critical path answers** - one real request returns the expected status and version; (3) **a mismatch is an outage** - tell the owner at once, run the runbook. Retire it when CI does it. Why: hand-deployed parts drift from merge-deployed parts silently. <!-- PROJECT ADAPTER A18 -->

Once it passes, any planned release is out and the thread has no other work open, the closeout starts on its own (rule:compact-ritual).

**Deploy config:** a hand-deployed part (a data index, a side service) needs its own upload and redeploy on each version change - write the runbook. A dashboard-only change to a config-file setting drifts back on the next deploy: durable changes go in the config file, secrets in the platform's secret store. Before a hand deploy, diff local config against committed, ids masked. Never roll back past a local-database schema raise (older code cannot open it); fix forward.

## Kit Stays Local {#kit-stays-local}

The kit lives in the working folder and never in the repo by default. The kit's own `CLAUDE.md` and the personal `CLAUDE.local.md` never go public, even when the kit is tracked; a repo that owns its `CLAUDE.md` keeps it, and the kit's goes to `CLAUDE.local.md` (the overlay). The install lists every kit path, and the owner's `never` list, in a marked block of `.git/info/exclude` (never pushed, so the names stay private) and turns on the kit's git hooks. `.kit/tracking.json`: `track` names every file the owner wants in the repo (kit files chosen to show growth are added on purpose with `git add -f`); `never` names paths that must never be committed (another party's material, private notes). Every commit runs the commit check: staging a kit file not in `track`, a `never` path or a secret-shaped file or value is blocked. Committing the whole kit (`"kit": "tracked"`) is the owner's explicit choice, for a private repo only. **Limits:** git hooks run only where the kit is installed (another computer: install there first) and are skipped by `--no-verify` - a tool that uses it is a stop-and-tell-the-owner event. Why: the kit and the owner's notes are private working material; a public repo keeps every commit forever.

## First Push Gate {#first-push-gate}

Before the first push, run the strictest check once: `node .claude/first-push-check.mjs`, with the deep sweep (rule:sweep-tiers, first push). It reads every commit's whole tree (merges included) and fails on a kit path, a `never` path, or a secret-shaped file or value in ANY commit, a deleted one included; on an empty `track`, a `track` entry with no tracked file, or a wanted file that is ignored; and on a `never` file sitting unignored in the folder. It lists untracked files to decide. The owner reviews `git ls-files` against the plan. A history hit means rewriting history or a fresh repo, never "delete it in the next commit". The remote is made private first and public only after the owner checks what landed. On a pass the check records the commit; the pre-push hook lets only that commit (or its ancestors and tags) out until it is on a remote branch. **Protect main** once the repo is public and CI has a gate check: copy `.claude/kit/branch-protection.json` to `.kit/`, put the check's name in it (A26), on the owner's yes run `gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input .kit/branch-protection.json`, and read it back; the rule requires that one check, blocks force pushes and deletion, needs no review for a solo owner, and lets admins bypass. `/methodology-kit status` flags an unprotected main. **Every repo, private included,** turns on auto-merge and branch deletion once it exists, on the owner's yes (the gate prints the command; read back); with no required check the merge gate stays NO GO. Why: the first push sets the foundation; what it carries is public for good.

## Standing Grants {#standing-grants}

A standing grant (A27, the owner) lets a named outward act run without a yes per act. **Two acts are granted today: auto-fix's push (rule:outward-acts) and merge, through the merge gate** (`~/.claude/kit-tools/merge-gate.mjs`, installed by `install user` outside every repo). **The grant:** allow rules the owner adds to their own Claude settings for exactly `node <config>/kit-tools/merge-gate.mjs arm *`, `disarm *` and `autofix *`; Claude never writes them. Without them, each asks. **Before arming,** each check must pass: the kill switch is absent; the PR is open, not a draft, from this repo, with no changes requested, hold label, failed check or running optional check, and the working copy is at its head; the repo allows auto-merge and deletes branches on merge; the base requires a status check; the diff touches no gate or loaded-rule path (the tool's list); a sweep report for the branch names `**Covers:** <sha>` at or before the head, only `VERSION` and `CHANGELOG.md` changed after it, the approval log cleared it, every high names a real commit, and the sweep audit passes it; the live PR body passes the audit (the base's, else the user layer's). **GO:** it runs `gh pr merge <n> --auto --squash --match-head-commit <sha>`, reads it back and logs it in the common git folder's `kit-merge-gate.log`; GitHub merges on green and deletes the branch. **NO GO:** nothing is armed; `<git dir>/kit-merge-gate-triage.md` says what failed; the thread fixes its part and reruns the gate; the rest is the owner's. `check <n>` runs the checks without arming. **After arming:** a push first disarms it (the pre-push hook refuses one over an armed head), then the gate runs again; a stop set on GitHub is the owner's. A live turn tells the owner of the merge with its URL; nothing tells them of a later merge until E13 ships. **Kill switch:** `autonomy-off` in the Claude config folder: while it exists every merge and auto-fix push asks; an armed PR needs `disarm <n>`. **Never granted:** any other push, tag, release, branch deletes outside the merge, public posts, changing the grant or the gate, or anything a test or the sweep did not pass; each asks (rule:outward-acts). Why: the owner sets the conditions once and hears after with proof, and a gate the session can edit is no gate.
