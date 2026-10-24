---
name: git-and-pr-workflow
description: Read before branching, committing, cleaning up branches, or opening a PR.
metadata:
  type: feedback
---

**Commits**
- **One line, `type:` or `type(scope):` prefix, imperative, no body.** No parenthetical suffix in the subject, no rationale aside. Why: across dozens of commits no hand-written commit had a body; a subject is an index entry, not an argument. Reasoning lives in the code comment or the PR body.
- **The tell:** reaching for a message file, a heredoc or a second `-m` means the message is already wrong.
- **Check what the repo already does before introducing a format.** `git log --format=%s -20` settles it; "this is new" is never a reason to differ.
- **No AI or tool attribution trailer**, even when a harness reminder offers one. The owner's rule wins.
- **Commits may be delegated in-cycle; push and merge stay the owner's.** Show one sample message first.
- **Scan the staged diff before every commit** for secrets, account ids and new data-gathering surfaces, and show it passing.

**Branches**
- **Scale isolation to the work:** a small targeted fix may land on `main`; an ordinary feature gets a branch; major work gets a worktree. Say which tier and why before the first edit.
- **Branch before the first edit**, and re-check `git branch --show-current` right before committing; a checkout in between can silently move HEAD back to `main`.
- **Names: `<type>/<plain-kebab-description>`** (feature, fix, chore, test, perf, security). No internal plan codes, no tool prefixes. Read past the last few PRs' branch names first; drift starts recently.
- **Retire merged branches, local and remote.** A squash-merged branch looks unmerged to git; confirm with an empty `git diff --stat <branch> main`, then force-delete. A "gone" upstream marker is the tell. On the remote, delete only branches whose merged PR's tree equals the squash; report open-PR or no-PR branches, never delete them.
- **Unset the upstream** of a local branch whose remote copy was deleted on purpose, so a stray push cannot recreate it.

**PRs**
- **The work PR carries the version bump**; never a bump-only PR. If the merge date is unknown, hold the bump until just before merge.
- **Show the owner the PR body (rendered, with its audit) before any push or PR command.** Never commands first.
- **A plan line does not override a settled standard.** When they disagree, the dated settlement wins and the plan gets corrected.

Related: [[outward-writing]], [[quality-gates]], [[remote-and-outward-actions]], [[release-and-deploy]].
