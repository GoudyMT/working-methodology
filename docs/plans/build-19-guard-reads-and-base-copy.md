# Build 19 plan: kit 1.45.0

Scope locked by the owner's pop-ups 2026-11-20: K145, the I7 leftovers, K146 to K148, and the last piece of T13 (the
web-app templates). I9 and J-R1 shipped in 1.44.0 and close in the workbench with no build. T11, T12 and TC0 to TC5
wait for build 20. Plan approved by the owner's pop-up "Yes, as written" 2026-11-20. One branch from main at 8cca4e4, one sweep, every finding fixed in the build. Cost: $0 cash; one
sweep and one recall run on plan quota (the recall run is asked again with its real number first).

## 1. Proof first (done, no kit change)

Run 2026-11-20 on a throwaway clone of the v1.44.0 release, in a probe folder outside the repo: the project guard fed
directly, then the launcher with throwaway user and project installs, the way Claude Code runs them.

| Row | Result | Evidence |
|---|---|---|
| K145 read loop piped on | Real | `for f in .claude/guard*.cjs; do sed -n 1,1p "$f"; done` allows; the same loop ending `\| wc -l` or `\| head -5` denies with the protected-file message. With a `cd <project> &&` first it denies with the wrong message (it names the session transcripts) |
| K145 PowerShell reads | Real, new shapes | `cd <project>; Get-ChildItem .claude -Recurse ...; node .claude/tools/state.mjs --help 2>&1 \| Select -First 30` denies, each half alone allows; `foreach($i in 'O4','O2'){ node .claude/state.mjs item $i \| Out-String }` denies, one `node .claude/state.mjs item O4 \| Out-String` allows. Both held live in this thread too |
| K145 scratchpad writes | Not reproduced | Write and `echo >` into `<temp>/claude/<id>/scratchpad` allow; a Write into this thread's scratchpad also passed live |
| K145 joined reads | Not reproduced | `cd X; git -C X fetch origin`, `git show HEAD:README.md > <scratch>`, two git reads joined by `;` all allow |
| Live only | To diagnose | A `cd <project> && node -e '<multi-line script>' \| wc -l` held live with "more than 64 folders to read its wildcards from"; the same command allows in the throwaway. The count depends on the real disk, so the build finds which token reads as a wildcard |
| I7 leftovers | Closed, no build | The re-sweep they came from is gone (A2, 1.42.0; approve.mjs refuses `resweepOf`). The narrowed dirty check is tested (kit-sweep-budget.test.mjs, "uncommitted work in the contract's folder counts"), and that test plants a contract-shaped JSON and a settings JSON beside the contract. The dependency half shipped in 1.44.0 |
| T13 web-app templates | Real | An empty project (no package.json, no UI) gets `_Component Spec Template.md` and `_Component Security Checklist.md` |
| K146 to K148 | Owner-approved, by quote | PRs 56 and 57 came from CI judging PR 55 with main's copy of the checks (K135). K148 is reproduced in the build with a failing-first test before any change |

## 2. K145: reads piped on stay reads

The guard reads a pipe's tail (`wc`, `head`, `tail`, `sort`, `grep`, `Select`, `Out-String`, `Measure-Object`) after a
read loop or a read of a protected file as a read. A PowerShell `foreach` whose body only reads gets the same rule as
the Bash `for` loop K138 widened. Each widened shape gets a must-pass row with its write twin beside it (a pipe into
`tee` or `Set-Content`, `-o` or `>` to a protected file, a `foreach` that writes). The wrong message (transcripts named
for a guard read) is fixed with its own test. The 64-folder hold is diagnosed first and fixed only if the cause is a
false wildcard read; if the count is right by design, the row records why.

## 3. T13: web-app templates install only where they fit

`install project` copies the two component templates only when the project has a UI marker (package.json with a UI
dependency, or a components folder); `--with-templates web` adds them on request. An install that already has them
leaves them. The Visuals block in the PR body and changelog templates stays as is.

## 4. K146 to K148: base-copy lessons

K146: plan-feature and the build steps say to open the build PR as a draft right after the first commit, so main's
checks run on the branch from day one. K147: the plan template asks "can main's checks read this branch?"; a plan that
adds a new test or helper kind, a large deletion, binaries or a file type the checks read names the check change and
ships it first as a small PR. K148: when the base copy cannot load a test file the base already has, test-check says
"main cannot load this" and names the missing import, not a failed test.

## 4b. K125 gap: a claimed move needs Visuals (added by the owner's pop-up 2026-11-20)

PR 55 claimed the repo lost about 13 MB with no Visuals section, and the audit passed it: the K125 design's presence
check (a body that claims a measured number moved must carry Visuals, and each such number must sit in its table)
was never built. The Standard PR audit and the release notes audit gain it, test-first, with PR 55's body as the
failing case. Tallies (tests, findings, mutants) stay outside it, as the design says.

## 5. Sweep, recall, PR

Order: 4 (the draft PR rule applies to this build: the PR opens as a draft after the first commit), 2, 3, then one
feature sweep with the security modifier (guards change). Items 4 and 3 change rule and template text, so one recall
run on the final text. Then CI, and your merge, tag and release.

## Stops for the owner

This plan; the recall cost; merge, tag, release.
