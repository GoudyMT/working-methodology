# Build 20 plan: kit 1.46.0

## Overview
What we are looking at: four of the owner's standing rules that slipped because only prose held them, the guard
check that names a false reason for wildcard reads, the cost of the tracking files every thread reads at start, and
the release step whose title and notes drift from the build record.
What was found or measured: build 19 reran about 170 unchanged tests locally and one sweep role ran 1,072,274 tokens
against a 749,524 ceiling; the dash check held six read-only command shapes falsely; a short-view start-up cost
$0.35 against $0.70 with the same pick; five of the last eleven release titles are a bare tag.
What is being decided: the scope below, picked by the owner's pop-ups on 2026-11-20.

Scope locked by the owner's pop-up 2026-11-20: everything offered. K150 to K153 (four starred rules held by a script or
hook, design: the rule-enforcement brainstorm, sections A to D and the owner's pick), K155 and K156 (the dash-name
wildcard check), and TC0 to TC5 (the tracking-cost cuts). TC4 and the start instruction of TC3 are workbench files, so
the step 6 thread does them. Prose: each rule's prose copies outside the kit text (memory lines, coordinator-brief
lines) are cut at closeout once its check holds; no kit rule line changes, so no recall run. One branch from main at
80883d5, one sweep, every finding fixed in the build. Cost: $0 cash; one sweep and the TC0 proof run on plan quota.

## 1. Proof first (done)

Run 2026-11-20 on a throwaway clone of the v1.45.0 release in a probe folder outside the repo, the project guard fed
the hook input directly.

| Row | Result | Evidence |
|---|---|---|
| K155 false dash holds | Real, 6 of 9 shapes | A wildcard in a folder part (`ls x/*/SKILL.md`), `echo exit=$?`, a cd to a quoted or variable folder, a quoted grep pattern with a star, brackets in quoted node code: each held with the dash reason, no dash-named file anywhere |
| K155 other shapes | Not reproduced, closed | A PowerShell foreach over `@('x')`, a quoted `--with-templates web` note and `node --test` of one file all pass the guard |
| K156 missed folder changes | Real, 2 of 3 shapes | A bare cd then a new line, and two chained cd's, let `sed -n 1p *` through with a planted `-i` where the shell lands |
| K156 the `~` shape | Not real, closed | `~/*` expands to full paths, which never start with a dash |
| TC0 short view | Pass | Same start task on two throwaway copies: both picked TC0 with the same scope and first tools; the short view cost $0.35 against $0.70 for the full list |

## 2. K155 and K156: the dash check reads as bash does (done)

The command is split as bash splits it (quotes, escapes, parameters such as `$?`, here-document bodies). Only a
wildcard in a word's first part can make a word that starts with a dash, so only that part is read, in the start
folder and in each cd's folder followed in turn. A folder change the guard cannot follow (a bare cd, `cd -`, popd, a
variable) holds with its own reason, not "a file starts with a dash". Two shapes stay held by other readings on
purpose: a quoted pattern with `*(` (inline code is read in pieces) and a here-document body (read as commands since
1.24.0); both fail safe, the K154 class.

## 3. K150: local test runs reach only the changed tests

A user-layer kit hook (`kit-hooks/test-scope.cjs`, run by the one guard process, no new hook entry) reads Bash and
PowerShell test runs from a short runner table. It allows a run that names only test files in the branch's change set
(diff against the default branch's merge base, plus uncommitted and new files), and asks the owner's pop-up for the
rest: a run with no file, `test-run.mjs --changed` without `--pick`, a test file outside the change set, the CI-only
scripts. No branch ahead of the default one (a throwaway clone on a tag) or no git repository: allowed. A fail-open is
logged. `scripts/test-run.mjs` refuses a full or `--changed` run off CI unless given `--owner-yes`.

## 4. K151: the sweep meter fails loud

Replay build 19's role 1 transcript through `call-cap.cjs` first, to find where it let calls through. Then: each
fail-open writes one log line (the cause, never content), and the sweep approval step sums each role's real usage
from its transcript; a role over its ceiling, or a fail-open line, keeps auto-approval paused and names the role.

## 5. K152: every new test is named in the build record

Test check A7: with `--record`, each new top-level test must be named by a build item's or a sweep fix's `test`. A
sweep fix that adds a new top-level test, not a row in an existing test, must be high severity or security, or carry
a `reason`. Kit only.

## 6. K153: retired rule wording is caught at closeout

`rules/retired.json` (old phrase, new rule id, version) and a small script that reads the working-memory files for
retired phrases: a hit fails the closeout's release check and names the line; session start adds one line of context
when one is found. A note marked `(history)` is skipped.

## 7. TC1 to TC3, TC5: the tracking-cost cuts

TC1: `state.mjs` marks a row done only with its verify result path, a file that exists. TC2: the status board is
built by script from the list data. TC3: the list's rows view shows open rows only; done and closed rows go to an
archive view built from the same data, so no row is lost. TC5: the Session Log leaves the start order (or becomes one
generated line), and the stale prose sections of the Working Memory template go. Each cut is checked lossless: every
row of the data appears in exactly one view.

## 8. Sweep, PR

One feature sweep with the security modifier (guards change), every finding fixed here; CI; the owner's merge, tag
and release.

## Stops for the owner

Merge, tag, release.
