# Changelog

## 1.9.1 - 2026-10-30
- Sweep auto-approval: a version-only package.json change is no longer read as a new dependency (only dependency fields count); while paused, every ask prints the pause date, reason and the owner's resume command, and the closeout carries it into each handoff; an owner-decided sweep can log its outcome.

## 1.9.0 - 2026-10-30
- PR-body audits read a project's own gates, audit line and verified-clean lines from .kit/pr-body.json, keeping the secrets line for all (closes IR-2026-10-30-pr-body-audit-holds-checks-from-another-project), and fail shipped code with no version bump unless the body says 'No user-facing change'. The closeout sends the full handoff text to the coordinator as one message, never a path, and ends on its confirmation (audit.mjs --send prints the text). Uploads are attached by the path the upload reported.

## 1.8.0 - 2026-10-30
- Sweeps run the approval script before any ask: it prints the owner's start notice from checked data, logs the owner's yes after an ASK (--owner-yes), and a hook holds reviewer agents to the cleared team at the contract's HEAD (closes IR-2026-10-30-sweep-approval-miss). A kit-owned improvement report format: template, 'new', an audit that refuses unproven causes and any fix that lowers a standard, open reports in /methodology-kit status. [trial] Mid-model reviewers for roles other than security and the novel lens, logged with --real-mid. The closeout deletes served temp files from shared and uploaded places too.

## 1.7.1 - 2026-10-30
- Troubleshooting starts with the kit status check: when a kit hook, skill, role or rule misbehaves, run /methodology-kit status first, update if it is not current, start a fresh session, then retry (rule:failure-response step 0)

## 1.7.0 - 2026-10-30
- Add /methodology-kit status: a read-only check of the kit folder, ~/.claude and a project against the latest kit, file by file

## 1.6.1 - 2026-10-30
- Agent canary in the Claude desktop app: the report is now checked when the agent calls the hand-back tool, because a live capture showed the stop event fires before the hand-back reaches the agent's transcript (so 1.5.0's stop-time read logged every agent 'unchecked'). A miss refuses the hand-back with the close-out steps; the close-out hand-back goes through. Every role file runs the check on its hand-back call.

## 1.6.0 - 2026-10-29
- Size asks: a portable size-band script applies a plan's approved size raise from measured sizes and asks only when a measured size passes what is allowed. The margin is headroom, never a reason to ask; a line the plan did not raise is left alone while under its limit; a file count is raised exactly; a band that cannot be read as whole numbers is refused. The size rule now says to ask once from a measurement (never an estimate) and drops the drift floor where measuring builds are identical. Found from false one-byte asks in a real run.

## 1.5.0 - 2026-10-29
- The agent canary now checks agents in the Claude desktop app, where a report is handed back through a tool: the hook reads it from the latest turn of the agent's own transcript (checked on real transcripts: right phrase hit, wrong phrase miss). Sweep auto-approval: a script approves a Swarm Contract that stays inside its tier's rules, with no tokens, and sends anything else to the owner with the reason; the branch's diff sets the tier floor and modifiers, caps only go down, the log is chained in the repo's git folder, only the owner resumes from their own terminal, and a 10-sweep trial pauses on an overrun, repeated findings or an escaped bug. Recall 9/10.

## 1.4.0 - 2026-10-29
- The kit stays local: the install keeps every kit path and the owner's never list out of git in the folder's own exclude file (never pushed), turns on the kit's git hooks, and .kit/tracking.json names what the owner wants tracked (growth files added on purpose) and what must never be committed. Every commit runs a check that blocks staging a kit file, a never path or a secret-shaped file or value, from any tool. Before the first push, a strict check reads every commit a push can carry (merges included) and the pre-push hook lets only the commit it cleared go out; a new first-push sweep tier goes with it. Proved live: a clean push, a slip in history blocked, an agent's slip blocked, a host-made README not ending the gate. Recall 8/10, level with 1.2.0.

## 1.3.0 - 2026-10-29
- Agent canary: every kit agent opens each message to whoever started it with a confirmation phrase it can only learn by reading its rules block to the last line. A Stop hook checks each agent's message and, on a miss, has the agent stop and reply with a close-out note; the lead saves the hand-off and a fresh agent picks up. After two failed cycles on a unit the run stops. A guard refuses any brief or message that carries the phrase, and the PR body and release audits fail on it. Every check is logged. A new reviewer role runs sweep agents so they are checked too. Proved live with a hit, a miss with close-out and pick-up, and a refused leak. Recall 8/10, level with 1.2.0 under the same scorer.

## 1.2.0 - 2026-10-28
- Format skills: PR body, release notes, closeout, preview test, Pre-PR sweep and ADR each get a skill with steps, examples adapted from real pieces and an audit script. The rules stay in the project's rule modules (any AI keeps them); each skill points to its rule. Sweeps now have tiers (feature, fix, triage, launch gate) with modifiers that add roles, and the sweep audit holds a report to its tier. The push guard reminds Claude of the PR body skill. Recall 9/10, level with 1.1.0.

## 1.1.0 - 2026-10-28
- Size budgets are now opt-in per project, chosen at kit setup (adapter A12; `none` turns them off). Agent access: a role table sets each agent role's tools, denied tools and the rules it starts with (builder and checker get them as preloaded skills). Guards back it: the builder's edit fence (its own worktree, and its unit's file list kept in git's folder), the checker's clean-tree stop (blocks once, names only changes made while it ran, never asks for a restore), and a git pre-push hook that holds the push line for any AI tool that marks its shell (turn on with core.hooksPath). All proved with known-good and known-bad tests and live in Claude Code; role files must stay user level, or Claude Code skips their hooks. Recall 9/10, no lower than the baseline.

## 1.0.0 - 2026-10-28
- Rule modules: the standards became a core (written out as AGENTS.md) plus 12 modules that load by file or on demand, moved word for word (0 lines lost or copied; 16 reworded and 1 added, each recorded in docs/migrations). Every rule has a fixed ID; pointers use rule:<id>; find and tags look rules up; build writes Claude Code's files from the tool-neutral rules/; install retires the old file only when unchanged and replaced; fold-back reads a project still on one standards file. CLAUDE.md imports now resolve (0.7.0's never loaded the standards). Session start 44,531 bytes. Promoted directly by the owner (plan approval).

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
