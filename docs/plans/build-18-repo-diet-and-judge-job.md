# Build 18 plan: kit 1.44.0 (after the 1.43.1 test split)

Scope locked by the owner's pop-up 2026-11-19: T10's rest, K135 to K144 (K142 is done), and the 13 parked sweep rows,
verified first. One branch from main after PR 54 merges, one sweep, every finding fixed in the build. Cost: $0 cash
except one recall run (step 9, about $30 to $60 of quota, asked again with its real number first). CI is the normal
PR run each push.

## 1. Proof first (no kit change)

Every row is suspect until reproduced on the released kit. Already reproduced: K139, K140, K141 (code quoted), K135
and K136 (named limits in the 1.43.0 record), and I9 (the split's own sweep ask: a .json under docs counts as feature
work). Still to prove in a throwaway install, each with a recorded run: K138 (four read shapes held), K144 (one
pop-up, four acts, only the first unlocked), K143 (each of the 4 shipped-code CodeQL alerts by a real input), and the
12 other sweep rows. First reading of the sweep rows on 1.43.0:

| Row | Plain words | First reading |
|---|---|---|
| I7 | The new-dependency list misses Maven, Gradle, .NET and PHP files; old re-sweep detector work | Dependency half real (the list in approve.mjs lacks them); re-sweep half likely closed (re-sweeps are refused flat since 1.22.0) |
| I9 | A .json under docs counts as feature work | Real (seen today) |
| I10 | Reviewers can write outside their scratch folder | Real in part: the brief names a scratch folder, no hook holds it |
| I16 | Sweep guard and approve.mjs hardening from a 1.13 review | Guard half likely fixed (C4, 1.3x); approve.mjs half to check |
| M24 | Reviewers could run no commands | Changed: today's reviewer ran the test check, but its own node probes were held |
| I23, N2, N3, N4 | Sweeps run over budget; crashed reviewers count; warning only at the end | Likely closed by call caps, token ceilings and the per-call hook (1.33 to 1.40); to show with the last three sweeps' logs |
| S17-C9 | Six small 1.17 carry-overs | Each checked against today's code |
| J-R1 | Does sweep auto-approval earn its keep | Measured before: 0 of 26 owner yeses changed what ran. Feeds item 4 |
| O8, E21 | Trials and research, not faults | Closed as not-a-fault with their data, or left with you |

A row that does not reproduce is closed with its evidence, not built.

### Proof results (2026-11-19, on the released 1.43.0, $0)

Approved by the owner's pop-up "Yes, as written" 2026-11-19. Probe scripts: thread scratchpad `k138.cjs`, `k143.mjs`.

| Row | Result | Evidence |
|---|---|---|
| K138 | Real | Release-copy guard in a throwaway project: a sed loop over guard files, cmp against a guard, du then ls of .claude (with && and ;), node -e reading or hashing a guard all deny; the same reads on other files allow; every write twin denies |
| K144 | Real | `owner-yes.cjs` line 145: `spend(yes.id, ...)` spends by the pop-up's id, so the first act of a pop-up with several questions spends it for all |
| K143 | 26 false; 25 goes with vendor/; 23 and 24 not as flagged, but a real gap beside them | Alert 26: the built pattern only holds a count from `#{1,6}`. Alerts 23/24: nested or broken comment markers still read as a Requested by line, yet `Re<!---->quested by the owner` (a comment inside the word, which the page hides) passes both audits. Test alerts: each triaged in the build |
| I9 | Real | The 1.43.1 sweep ask: "an added source file (docs/builds/1.43.1.json) is feature work" |
| I7 | Dependency half real; re-sweep half closed | DEP_FILE (approve.mjs line 125) lacks pom.xml, Gradle, .csproj, composer.json; no re-sweep detector is left in the audits (re-sweeps are refused flat) |
| I10 | Real | The brief names a scratch folder, but no hook holds a reviewer's Bash writes to it |
| M24 | Real in part, folded into K138 | The 1.43.1 reviewer ran the test check, but its own read-only node probes were held |
| J-R1 | Feeds item 4 | `--summary`: 19 approved, 71 sent to the owner, 21 sent back; 0 of 26 owner yeses changed what ran (P3) |
| I16 | Closed | Guard half fixed by C4 (each role starts once, by the sweep its brief names); approve.mjs half by S3 (only reports and contracts in the sweep folder are left out); both tested in kit-sweep.test.mjs |
| I23, N2 | Closed | The last 14 sweep outcomes ran 0.58x to 1.11x their budget; none at the 1.25x pause |
| N4 | Closed | The call-cap hook stops a reviewer at its token ceiling while it runs |
| N3 | Closed, by design | A crashed reviewer's tokens count against its role, the owner's rule in the sweep skill |
| S17-C9 | Closed | Four of six fixed and tested (C9b outcome owed, C9c/S4 base checks, the brief's Sweep tag, C9f one HEAD read); growth figures from history and a contract known by its shape stay by design |
| O8, E21 | Closed as not faults | O8 is a running trial (97 real findings from mid-model roles so far, in `--summary`); E21 is research with no fault in it |

## 2. Shared test helpers (T10 follow-on)

The seven test files repeat about 150 KB of helper code. Move the shared helpers into one module,
`tests/kit-helpers.mjs`, and import them. Each test keeps its exact text, so the test check reads none as new.

## 3. vendor/ out of the repo (T10)

The 13 MB of other people's plugins leave the kit repo for a separate backup repo (kept private), with its credits.
`kit.mjs snapshot` and `restore` take the backup folder from the config, and the credit test reads it there. This also
removes CodeQL's one vendor alert. History keeps the old copy (no rewrite).

## 4. Sweep floor by diff risk (T10, with I9, I7, J-R1 and the real sweep rows)

Today the floor reads line counts and added files, so a 20,000-line test move asked you. New rule: the floor comes
from what the diff touches. Guards, hooks, gates, CI and install code: feature with the security modifier. Shipped
scripts and skills: fix. Tests moved unchanged, docs, records and maps: triage. A dependency file in any ecosystem adds
the supply-chain role. Line count only raises a tier, never decides it alone.

## 5. One home for process skills (T10)

The kit's own skills are the home. superpowers is already off in your settings; it stays only as a credited backup,
and nothing in the kit names its skills.

## 6. CI judge job that runs no PR code (K135) and the map behind the launcher (K136)

K135: the test check splits in two jobs. One runs the PR's tests and uploads results; a judge job reads only those
results with main's copy of the checks and never runs PR code. The six content checks move to the judge job too.
K136: the launcher's start line keeps the coverage tracer when the test harness sets it, so the PR test pick sees code
reached through the launcher, and `--whole` is no longer needed there.

## 7. Privacy (K141, K140)

K141: install reads your profile from `~/.claude/kit-owner-profile.md`, outside the repo; the repo keeps a blank
example and scrub stops skipping the file. The release's install into the workbench (the last step of the release
order, after the tag) first copies your current profile there, before the new tag is checked out (your yes);
install user refuses rather than blank Owner Context lines it finds with no profile.
History keeps the old file, as you chose. K140: README and recall.yml say the repo is public.

## 8. Audits and guards (K139, K143, K138, K144, K137)

K139: the build record check and the PR body audit both need at least one Where row. K143: each reproduced alert fixed
with a failing-first test; each false one dismissed in GitHub with its reason. K138: must-pass rows for the four read
shapes beside their write twins (node -e stays strict). K144: one pop-up with several Yes answers unlocks each quoted
act. K137: the recall script refuses to start when a rule file is over its cap, and refuses an extra-runs offer that
decision 7 rules out.

## 9. Sweep, recall, PR

One feature sweep (security-sensitive) on the whole branch. Items 4 and 5 change rule text, so one recall run on the
final text, after K137's cap check passes. Then the PR, CI, and your merge, tag and release.

## Order and stops

Proof (1), then 2, 7, 8, 6, 3, 4, 5, then 9. Pop-ups to you: this plan; each proof result that closes a row; the
recall cost; merge, tag, release.
