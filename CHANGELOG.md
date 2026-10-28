# Changelog

## 0.7.0 - 2026-10-28
- One size request per plan with one end check (trim or lower); the preview tested by stakes (emulation by default, the owner's device where only a hand can tell); PR bodies say each thing once; the closeout sends the handoff to the coordinating session and closes the thread; a merge-and-retire pass to stay under the cap. Promoted directly by the owner.

## 0.6.1 - 2026-10-27
- Rule-conflict fixes: a fix after an Op-Test re-runs only the touched suites (the final gate covers the rest); a feature PR keeps the Pre-PR Deep Sweep reviewer floor, with sizing above it; a retry alone means no other gate, hook or agent test running.

## 0.6.0 - 2026-10-27
- Speed review: copy lines and a size-raise band settled at plan approval, one check-in per phase; one review lead for the whole tail; a CPU load guard (.claude/load-guard.cjs, 40% over 3 s, --force overrides); the commit hook runs the fast suite plus related browser tests, everything on config, lockfile or deletion, proved by a known-bad control; E2E beside the non-building gate steps; every pick runs the hook; size checks once per batch; a combined fix check only for at most 2 roots, none above low. One session per prong; agents only for parallel or wide work or an independent review; every plan has an Execution approach section. Skills by case: at most two per unit, with design, motion and review sets apart. Promoted directly by the owner.

## 0.5.0 - 2026-10-27
- Summary, not tallies: PR bodies and other outward summaries state the end result; a number stays only when it is the result or the reader acts on it. Promoted directly by the owner.

## 0.4.0 - 2026-10-27
- Kit standard: session-start and pre-compact kit hooks, rule sort, skills by case, credited backups of the UI/UX skills, vault backup, one home per rule (memory as pointers), briefs read one rules block, merge-and-retire under a size cap, slips become guards, trial before standard; the rule-flow map; a per-message check so a session running in parallel hears about a kit release made meanwhile. Promoted directly by the owner.

## 0.3.0 - 2026-10-27
- Rule sort for the kit at every pre-compact closeout; test and review cadence rules (related-tests hook, full gate per phase, combined fix check, reviewer limits, crash log).

## 0.2.0 - 2026-10-25
- Keep a credited backup of every third-party plugin and skill in vendor/, with snapshot and restore commands.

## 0.1.0 - 2026-10-24
- First version, distilled from the owner's working setup: global rules, agent roles, skills (agent-team-build, teacher, teacher-sync, human-factor, methodology-kit), general project standards, tracking-file skeletons, templates, tools and working-style memory.
