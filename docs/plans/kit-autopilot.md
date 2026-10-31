# Kit autopilot: review of design v3 and implementation plan

Status: **plan, awaiting the owner's go.** Nothing is built yet. The kit repo isn't attached to this project, so file paths below are the ones the design names.

---

## Part 1: Review

The core idea holds up: the real security boundary is "reproduce it on a fresh install before anything changes", and the design already treats report text as data. Most of the gaps below are places where a session could edit or forge the very thing that is supposed to constrain it.

### A. Sender-ID trust model (step 0a, 5b)

1. **The registry is written by the sessions it authenticates.** The session-start hook registers any folder "with a kit install". Anyone who clones a repo that contains a kit install (or creates `.kit/` in a scratch folder) becomes a known sender on next session start. "Known" therefore means "ran in a folder with a kit", not "a project the owner owns". **Fix:** the hook only proposes an entry (`registry/pending/`); an entry becomes known when the owner confirms it once (one line in `/methodology-kit status`), or when the folder is on an owner-written allowlist of project roots.
2. **The registry file must not be writable by project sessions.** If it lives in the kit folder and project sessions have write access there (they do, to copy into `reports/inbox/`), any session can add itself. **Fix:** registry writes go only through the kit's hook script, and the inbox is the only path project sessions write; check this with a permission rule, not convention.
3. **Verify the sender ID actually exists and can't be set by the sender.** The design depends on "the sender ID Claude Code attaches to every message between sessions". Before building on it, confirm in Claude Code docs which field this is, whether it's present for `claude -p` and Remote Control sessions, and whether a session can set it. If it can't be confirmed, the fallback is a per-project secret written at install time (HMAC on the report file).
4. **Session IDs are per session, not per project.** Every new session is a new ID, so the registry grows forever and "first-seen date" says nothing about trust. Key the registry on the project folder (plus its git remote), and record session IDs under it.
5. **Name what the sender check is for.** It's a noise and spam filter, not the security boundary; verify-by-reproduction is. Say so in the design so nobody later relaxes verification because "the sender was known".

### B. Prompt injection

6. **The verifier runs commands, and the report contains commands.** Step 1 says read-only, but reproducing means running a fresh install and commands in a temp folder. If the verifier copies the report's "running log" commands, the report author chooses what executes. **Fix:** the verifier writes its own reproduction from the kit source; report commands are reference only and are never executed verbatim. Run it with no network and a temp HOME.
7. **Injection can travel through the verdict.** The build session's brief should get the verifier's structured verdict (JSON: verdict, repro command, failing output, file paths in the kit), never the report text. Free-text fields in the verdict are quoted and length-capped.
8. **"project-error is written back to the project's report"** is a write into another project's folder from the kit. Either make it an append to the kit's own `reports/` that the project reads at its next start, or list it as a granted act.
9. **Filing "starts the autopilot in the background"** from the project session means a project session launches a process that then runs with the kit's permissions. Keep it, but the spawn must be a fixed command with no arguments taken from the report (just "process inbox"), and a lock file so two filings don't start two runs.

### C. Grant and kill switch

10. **The grant lives in the repo the build session edits.** `.kit/autonomy.json`, `autonomy.mjs`, `approve.mjs`, the scrub, the size caps and the test runner are all in the kit repo. A fix that edits any of them can weaken its own gates. **Fix:** `autonomy.mjs check` reads the grant and itself from `origin/main` at the base commit, not from the worktree; any diff touching a protected path list (`.kit/`, `autonomy.mjs`, `approve.mjs`, sweep/scrub/caps scripts, test harness config, Tier 0 rule text) is an automatic "ask the owner".
11. **"The grant cannot widen itself" needs enforcement on GitHub too.** Branch protection or a CODEOWNERS rule on the protected paths, so even a bad local check can't push a grant change.
12. **Kill switch location and timing.** `.kit/autonomy-off` inside the repo can be deleted or committed over by a session. Put it outside git (kit folder, untracked) and check it fail-closed: before spawning each headless session, before every act, and right before the push (check, then act, with nothing slow in between).
13. **Evidence must come from the check, not the session.** "The new test failed before the fix" should be proven by `autonomy.mjs` running the new test against the base commit and the head commit itself, not by reading a claim in the log. Same for full tests, scrub and caps: run them, don't read them.
14. **The 3-a-day release cap** needs a source the session can't edit: count today's tags on GitHub, not a local counter.
15. **Tier 0 detection:** define it concretely (hash of the Tier 0 blocks in CLAUDE.md and AGENTS.md at base vs head).
16. **Messaging every running session (5b) isn't in the grant's act list.** It reaches the owner's machine and Remote Control. Add it as a named act with its own condition (only after the SHA read-back succeeds).

### D. Pipeline gaps

17. **Concurrency:** two reports in flight can both bump to the same version. Serialize release (one lock, rebase and re-run gates if main moved).
18. **Dedupe:** the same gap reported from five projects should be one run. Hash the reproduced failing output and link duplicates to the first report.
19. **Failure states:** the design covers verify verdicts but not "build couldn't make it pass", "sweep not clean", "gates passed but push failed". Each needs a terminal state and an owner line in the log.
20. **Version wording is inconsistent:** step 4 says patch or minor; step 5 says releases are "minor or major". The autopilot never makes a major, so the "update now" path in 5b only fires for owner releases. Fine, but say it, and use semver terms consistently (patch/minor auto, major owner-only).
21. **Rollout blast radius:** a bad release that passes every gate updates every project at its next session start. Add a soak: auto-update only after the release is N hours old with no revert, and an "autopilot paused" flag in a release that projects honor.
22. **Cost cap:** 3-5 sessions per report with no daily ceiling on verify runs. A flood of reports (even from known senders) is a cost attack. Cap verify runs per day and per sender.
23. **Trial gate:** the two false reports should be specifically (a) a genuine project error and (b) a planted instruction. Add (c) an unknown sender and (d) a kill switch flipped mid-run, as named test cases, not just "2 false reports".

### E. Rule 14 wording (Tier 0)

The wording reads well. Two suggested additions, both small:
- "...a standing grant the owner wrote **and only the owner changes** (adapter row A27)..."
- "...and a kill switch **outside the repo** stops the next one."

**Approved by the owner 2026-10-31 (with both additions).** Final text:

> 14. **Outward acts are the owner's unless granted.** Nothing is pushed, merged, released or published without the owner's knowledge and go, except under a standing grant the owner wrote and only the owner changes (adapter row A27): the grant names its acts and the conditions each must pass; every granted act is logged and reported after with proof, and a kill switch outside the repo stops the next one.

---

## Part 2: Implementation plan

Order is chosen so each phase is safe on its own: nothing can act outward until phase 4, and phase 4 only on the kit repo.

### Phase 0: Prerequisites
- [x] the owner approved Rule 14 wording with the two additions (2026-10-31)
- [x] Attach the kit repo to this project - the owner chose to run the kit work on the PC, in the kit folder (2026-10-31)
- [x] Confirm the sender-ID field in Claude Code - not an identity: per code.claude.com/docs/en/cross-session-messaging a cross-session message carries the sender's self-chosen session name (`--name` or `/rename`), and no per-project identity is documented. Fallback chosen: a per-project secret written at install time outside the repo, an HMAC on every report, and the registry keyed on project folder plus git remote
- [x] Turn on branch protection for the kit repo - kit-tests is required on main (2026-10-31)
- [ ] CODEOWNERS for the protected paths (`.github/CODEOWNERS`, the same paths the grant check protects); it binds once the owner turns on "Require review from Code Owners" for main

### Phase 1: Rule text and grant format (no automation yet)
- [ ] Rule 14 in CLAUDE.md, non-negotiable 6 in AGENTS.md, `rule:outward-acts` standing-grants section
- [ ] `.kit/autonomy.json` schema: acts, conditions per act, protected paths; projects ship with an empty grant
- [ ] Recall test run on the rule text change (it's rule text)

Changelog note for the 1.13.0 bump (draft): The Standard PR body's Review section now carries the sweep summary: the commit the sweep covered, a result per dimension, each high or critical finding and how it was handled, deferred items with where they are tracked, and accepted risks; it never links the private report. The PR-body audit checks the new parts in order, so a body in the old Review shape (Reviewed across / Result / Pass table) now fails it: projects move to the new shape on update.

### Phase 2: `autonomy.mjs check <act>` (fail-closed gate)
- [ ] Tests first: missing grant, unreadable grant, kill switch present, protected path touched, Tier 0 hash changed, 4th release today, new test not failing at base, each returns "ask"
- [ ] Reads grant and itself from `origin/main`, never the worktree
- [ ] Runs the evidence itself (test at base and head, full tests, scrub, caps)
- [ ] Kill switch outside git; checked before every act

### Phase 3: Intake and identity
- [ ] Registry keyed on project folder + git remote; hook writes to `pending/`; owner confirms once
- [ ] `improvement-report.mjs file`: audit PASS, write to inbox only, spawn fixed `process-inbox` command under a lock
- [ ] Report schema (0b) with the running log; size caps on every free-text field
- [ ] Dedupe and per-sender and per-day caps

### Phase 4: Verify, build, review, release (kit repo only)
- [ ] Verify session: no network, temp HOME, own reproduction, structured JSON verdict; injection fixtures in tests
- [ ] Build session in a worktree, brief built from the verdict only
- [ ] Sweep plus approve.mjs at fix tier
- [ ] Release under a lock: bump, CHANGELOG with report ID, tag, push, SHA read-back, close report
- [ ] Every terminal state (including failures) writes one line to `reports/autopilot/log.md` and status

### Phase 5: Rollout and messaging
- [ ] Minor/patch auto-update at session start after soak window; honors "paused" flag
- [ ] 5b message as a granted act; receiver checks sender ID and `kit.mjs status` before updating; anything else in the message is reported, not acted on

### Phase 6: Trial
- [ ] 2 real gaps end to end, zero owner steps
- [ ] False: project error; planted instruction; unknown sender; kill switch mid-run; each declined with evidence, nothing changed
- [ ] Every act in the log with SHA read back from GitHub
- [ ] Review section added here with results

## Review (filled in after the trial)
