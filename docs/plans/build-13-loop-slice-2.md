# Build 13 (1.39.0): T7 slice 2, watchers, the plan shadow and the chain check

Locked by the owner's pop-up, 2026-11-16: scope "Slice 2 + New 3, New 4"; shadow streak 10 agreeing plans in a row;
the dead probe guard records are forgotten at closeout on their own pop-up. Branch `feature/loop-watchers`.

## Carry-overs first

- **K102 (fixed, d4ef092).** The release-notes audit read its tool words on the whole line, so a `.claude/` path in a
  code span failed notes the build record had passed. It now reads them in prose only, as the dash rule does.
- **New 4 (real, fixed, e40c110).** The rule's third lean gate is the sweep tier, and the Standard template's line is
  `<Tier> review of`, but neither audit checked a tier: a body naming none passed. Both audits now require it.
- **New 3 (not reproduced, closed).** Every command a throwaway install printed for the owner runs as typed in
  PowerShell (git, gh, and the merge gate line in both spellings); the hook and launcher lines give a PowerShell
  form; the sweep resume line is a plain `node <path> --resume`. Nothing found to fix.

## 1. Watchers (E13; locked A, 2026-11-03)

`user/kit-tools/watch.mjs`, in the Claude folder, so one watcher serves every project.

- `add <owner/repo> <pr> [--hours <n>]`, `remove`, `list`, `once` (one pass: what the schedule runs), `schedule`
  (prints the Task Scheduler line for the owner; registering a task is the owner's act, never install's).
- **Read-only by construction:** the only program it runs is `gh pr view <n> --repo <owner/repo> --json <fixed
  fields>`, with an argument list, no shell; a test fails on any other call.
- **Tells, never acts:** a desktop alert when a PR turns green, fails, conflicts, merges or closes; no alert for the
  same state twice.
- **Bounds:** each entry expires (48 hours by default, 14 days at most); at most 20 entries; three failed reads in a
  row stop that entry with a triage line and one alert; `watch-off` in the watch folder stops every pass.
- **First build gate (the probe's open point):** watch this build's own PR change from pending to green, live.

## 2. Plan self-approval in shadow mode (S3)

In the loop driver. Before the owner's plan step (`design` by default; `shadow.step` in the bounds file), the session
records `shadow --would yes|no --why "<why>"`; `done design` refuses without one. The step's act is made from the
verdict and exists only after it, so no ask made before the verdict can quote the act agreement is read from (the
commit review: ask first, then write a verdict to fit the answer). Agreement comes from the owner's own
pop-up answers to that step's act, never from the session: a `yes` the owner approved on the first answer adds one;
a `yes` the owner first answered No to resets the streak to 0; a `no` is kept as data and moves nothing. `show`
prints the streak against 10 (`shadow.streak`). Self-approval stays off: reaching 10 only says the owner may decide.

## 3. Thread chaining check (S13)

`loop.mjs chain <handoff.md> [--open]` says GO or STOP for opening the next thread. GO needs: the handoff passes the
closeout audit; no run is open or halted; the kill switch is off; and today's opened threads are under
`limits.threadsPerDay`. With no cap in the bounds file the answer is STOP: chaining is off until the owner sets one.
`--open` records the opening, so the cap counts it. Opening the thread stays the coordinator's.

## Decided alone

- **No rule text change.** The driver's own refusals and the plan skill carry the new steps, so no recall run is
  needed (a rule edit costs one). Reach is the same: the driver and the skill install into every project.
- **Tokens are not capped by the chain check.** The driver has no token instrument; the cap is on threads. Named as a
  known limit.
- **Watch kinds: pull requests only.** A release waiting on a step is the release check's job (K65).

## Known limits

The shadow reads only the owner's answers to the plan's act; a plan talked over in plain chat before the verdict is
not seen. One verdict per plan, so a revision after a No stays a disagreement. The watcher runs only while the owner is logged on, and alerts only on Windows.
