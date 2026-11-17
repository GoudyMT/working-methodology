# Build 16 (1.42.0): behaviour recall, then the AGENTS.md diet, with ten rows

Scope locked by the owner's pop-up, 2026-11-17 (D-1 to D-5): behaviour recall first, then AGENTS.md to 25,000 B, then
A2, A8, E4, K114, K111, K112, K110, K115, K116, K117. Branch `feat/behaviour-recall-and-diet` from main 83ab095
(v1.41.0). Reach is named per item: "kit" means only the kit's own repo and builds; "every project" means every
project that installs the kit.

## 1. Proof on the released 1.41.0 (done before this plan, $0)

| Row | Result | How |
|---|---|---|
| K115 | Reproduced | A body holding `` `claude -p` `` and `` `subagents.md` `` fails "no mechanism or AI words" in both audits (lines 82 and 35 test whole lines, code spans included) |
| K116 | Reproduced | In a clone at v1.41.0: a branch adds a gate line, then edits `rules/` again in a later commit; `recall.mjs gate v1.41.0 HEAD` passes both times (exit 0) |
| K110 | Reproduced | `git reset --hard`, `branch -D`, `stash drop`, `stash clear`, `reflog expire`, `checkout -- .`, `restore .` pass all three guards with no ask |
| K117 | Reproduced | The installed launcher denies, as a protected-file write, a `for` loop of `node .claude/state.mjs item` reads joined by `&&`, and a PowerShell `foreach` of the same read with `2>$null`; the single read passes |
| K111, K112, K114 | Reproduced earlier | The token proof run (2026-11-17): calls above 400K were 24.1%; idle-gap rebuilds 86% of rebuild cost; 114 of 119 subagent runs on Opus |

## 2. Behaviour recall (T10's recall part; folds in I17, I18, I19, S22-A5, M4 Q10). Reach: kit

Today a session is asked a question and a blind scorer reads its prose against a key. That grades wording, so a rule
cut can fail it while behaviour holds, and a borderline word decides a gate (I18).

**What it becomes.** Each of the 14 recall rows becomes a scenario: a seeded probe folder (git repo, plan files, a
fixture), one task prompt, and checks a script runs on what the session did, read from its `--output-format
stream-json` record: which tools it called, in what order, with what arguments, and what files changed. Bash runs
only a short read and test allow list; anything else it tries is denied and still recorded as an attempt, so an
attempted `git push` or `gh pr create` is graded without anything leaving the folder. No remote exists but a local
bare repo in the probe.

- **Scored by script.** Each check is pass or fail, so there is no blind scorer and no borderline (I18 closes).
- **Reads beyond the folder are caught.** Every Read, Grep and Glob path is in the record; a run that reads outside
  the probe or the Claude folder is invalid and named (I17 closes).
- **The user layer is measured.** The run header names the user-layer version, and a candidate's skills and agent
  files are copied into the probe's `.claude/` so the candidate's own versions answer (S22-A5; precedence proven in a
  probe before it is relied on).
- **Q10 as behaviour.** "Done and green, open the PR" passes only when no PR create is tried before a sweep report
  exists (M4 Q10 half).
- **The graded list widens** to `scripts/kit.mjs`, `project/` and `memory/` (I19): behaviour runs cost about the
  same as wording runs, so the owner's cost concern is answered with the numbers in section 9.

**Gate (D6, never lowered).** This build runs the behaviour suite beside the wording gate. CI requires both a wording
gate line and a behaviour gate line on a rule change. The wording gate is retired only on the owner's later lock,
after the behaviour suite is shown to catch at least what the wording gate caught.

**K116 in the same gate (reach: kit).** Every gate line names the commit it scored (`at <sha>`). CI refuses the line
when any graded file differs between that commit and the PR head.

Acceptance: a failing-first test per check kind (tool order, an attempted command, a file change, a read outside the
folder); a probe run of two scenarios on the released kit before the full suite is written; the full suite's median
on the candidate is not under the released baseline's.

## 3. AGENTS.md to 25,000 B, measured on the filled installed file (T9 rest, D-2). Reach: every project

The cap moves from 28,000 to 25,000, and the check reads AGENTS.md as `install project` writes it into a clean
folder (template plus the project's filled values, bytes on disk), not the template. A real project's use check reads
its own installed file the same way. The template goes to about 24,000 B so a project keeps room for its values.
Cuts follow build 15's rule: prose a script enforces goes; every line a behaviour check reads stays; each reworded line
goes in `docs/migrations/1.42.0-reworded.json`.

## 4. A2 applied: one sweep, no re-sweep (D-3). Reach: every project

Re-sweep text goes from the pre-pr-sweep skill and the rule modules, and the `resweepOf` path goes from approve.mjs.
The fix check is defined once: each fix after the sweep carries a failing-first test, and CI's test check is the gate.
I5, S17-C6, S17-C8, S17-C10 and S17-C11 close as no longer applying.

## 5. A8: the sibling rule text. Reach: every project

features-first item 2, the agent-team-build skill, the common brief and `testing.md` say what A2 and the 1.41.0
rulings say, in one home each.

## 6. E4: measure what loads at start. Reach: every project

A throwaway session on a fresh install reports each always-loaded piece (rule files, skill and agent listings,
plugin listings, MCP tool lists) by `/context`. Pieces nothing uses are cut. The security-guidance plugin is the
owner's own setting, not kit text: the measure decides the recommendation, and the owner turns it off or keeps it.

## 7. K114: cheaper model per subagent role (model half). Reach: every project

The reviewer role file moves to Sonnet 5.5 (MC3: Sonnet reviewers equal Opus at about half the cost). The sweep skill
names the model for each role it starts. The checker and orchestrator stay on Opus: MC3 measured reviewers only.

## 8. Session size and task end. Reach: every project

- **K111.** The installed project settings carry `autoCompactWindow: 400000`; the use check fails when the window
  in force is above 400K or under the 100K floor Claude Code ignores; a test proves an automatic compact
  (`trigger: auto`) writes the resume packet within the hook's time limit.
- **K112.** The closeout's last line, in a CLI or Code session, is the one command for the owner to type (`/clear`
  with the resume packet, or `/compact`). In a project thread (the session has the thread's reply tools), the thread
  closes when its work is done, so no line is given. Session start on a resumed session whose task is closed says so.

## 9. Small guard and audit fixes

- **K110 (every project).** The delete guard asks before `reset --hard`, `checkout` or `restore` over changes,
  `branch -D`, `stash drop` and `stash clear`, and `reflog expire`; each reproduced command is a must-ask test row, and
  `git status`, `git stash list`, `git branch -d` stay must-pass rows.
- **K115 (every project).** A tool word inside a code span passes only as part of a path or command (the span holds
  `/`, `.`, a space or a `-` flag); a bare `` `claude` `` still flags, as does any word outside a span.
- **K117 (every project).** The held read commands of section 1 and of `results/build16-scope/REVIEW.md` become
  must-pass rows in the guard tests, and the launcher is fixed until they pass.

## 10. Cost and order

- **Recall runs** are the only quota spend. Probe first: 2 scenarios, 1 run, about $2 of quota at list price. The
  full comparison is 3 candidate runs, 3 baseline runs and 1 control, 14 scenarios each: about $40 to $100 of quota,
  measured on the probe and restated before it runs. CI minutes: the normal PR run only (self-hosted runner, $0).
- **Order:** probe, then sections 2, 3 and 9 (guard rows go first as they are small), 4 to 8, then one recall
  comparison on the finished rule text, one sweep, the PR.
