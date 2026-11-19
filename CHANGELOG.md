# Changelog

## 1.44.0 - 2026-11-19

The owner's profile and the third-party backups leave the public kit repo, a sweep reviewer's shell can only read and write its own scratch folder, the sweep floor follows what a diff touches, and the content checks in CI run the base commit's copies.

### Added
- A recall run refuses rule text over its size cap before any session starts, and the scorer names the under-bar rule (decision 7).

### Changed
- Install reads the owner's profile from `~/.claude/kit-owner-profile.md`, outside the public repo; the repo keeps a blank example, and install refuses rather than blank Owner Context lines it finds with no profile.
- The sweep floor follows what the diff touches: gate code (CI and the scripts it runs, hooks, guards, the kit's install) is a feature sweep with security roles; docs, records and moved tests stay triage.
- [trial] One home for process skills: the kit's own skills; a third-party process skill set stays off, as a credited backup only.
- The kit's test files share one helper module, `tests/kit-helpers.mjs`, in place of the copies the 1.43.1 split left in each.
- README and the recall workflow say the kit repo is public.

### Fixed
- Each Yes in a pop-up of several questions unlocks its own quoted act once; a No still holds its act, and two questions of one text are no yes.
- The guards pass a read loop over a glob of guard files, cmp and du; a loop whose names split, set IFS, change folder or cannot be listed is still held.
- From 1.44.0 a build record needs an item naming a where, and the PR body audits need at least one Summary row, with CRLF ends read.
- The coverage map credits lines run from an installed guard copy to the repo file it came from, placing a filled-in copy's lines right.

### Security
- A sweep reviewer's shell runs only known reads (git reads, grep, cat, ls and the like, a script file) and writes only to its own scratch folder, named in full; anything else is refused.
- CI's six content checks (scrub, word check, project map, rule map, link scan, build is fresh) run the base commit's copies over the PR's tree, so that job runs none of the PR's code.
- The PR and release attribution checks read a Requested by line or marker hidden by an HTML comment, over a line break too, or by an empty link inside the word.

### Removed
- The third-party backups move from `vendor/` to a private repo cloned beside the kit, named by `vendor.dir`; the kit keeps `vendor-index.json`, the credits and a hash of each backup.

## 1.43.2 - 2026-11-19

The seven kit test files import one shared helper module in place of the copies the 1.43.1 split left in each, so a new test in them loads on main when CI proves it fails first. Nothing a project installs changes.

### Changed
- `tests/kit-helpers.mjs` holds the helper code the seven kit test files each copied; they import what they use, and every test keeps its exact text.

## 1.43.1 - 2026-11-19

The kit's largest test file is split into seven files, one per area, with every test moved word for word, so a change to one area reads and edits a file about a fifth the size. Nothing a project installs changes.

### Changed
- `tests/kit.test.mjs` is split into seven area files (install, rules, hooks, sweep, sweep outcome, sweep budget, recall). Each test keeps its exact text, and each file keeps only the old helper lines its tests use.

## 1.43.0 - 2026-11-18

The guards pass the reads they held from the workbench and still hold every write twin, CI judges a PR with the base commit's checks before any of its own code runs, the test check's planted-bug part measures only the tests it must, and behaviour recall grades scenarios 5 and 10 on what the session did.

### Added
- The test check reads a test moved word for word out of another test file as moved, not new, unless its new file brings code of its own; it names two tests of one name and a describe block it cannot read.
- The test runner packs tests over its shards by each test's last run time from the coverage map, so the shards finish together; slices split by name.
- The planted-bug check gains `--until-caught` (a test that caught a flip runs on no later one) and `--whole` (a survivor runs once more against every test of its files, credited to the test that went red, never to a timeout).

### Changed
- The testing rule and the CI templates: workers inside the job first, then shards once a lane's tests take over about 2 to 3 minutes, packed by each test's last run time; a runner that splits by file count needs a duration-sorted list.
- The test check's planted-bug part maps only the untagged tests it must measure, stops running a test once it has caught a flip, and is sliced by test, so it fits CI's budget on a large PR.
- Behaviour suite v2: scenario 5 passes only with no edit of the page and an ask about the layout, and scenario 10 only when the sweep skill starts and no PR command runs; the PR and merge checks read `gh.exe`, `gh -R` and `gh api` too.

### Fixed
- The guards pass a kit script given a quoted note with a bracket, a read loop then a command, and three PowerShell read shapes; each write twin, and any loop whose body changes folder, is still held.
- A hook given no folder places a command's words from the project folder, so a write through a link into `.claude` is held wherever the hook process runs.

### Security
- Judging a PR, the PR body audit and the version bump check read the project's settings from the base, so a PR cannot set the rows its own body is held to.
- CI runs the base commit's copy of every check that judges a PR (the test check, names, secrets, the build record, the PR body audits), unpacked before any of the PR's code runs and with git's replace refs off.

## 1.42.0 - 2026-11-17

The recall gate also grades what sessions do, the always-loaded rules file is 14% smaller under a lower cap, a PR or release whose measured cost moved shows it in a checked Visuals section, a branch gets one sweep, and the guards hold destructive local git while passing plain reads.

### Added
- Behaviour recall: 14 tasks run in seeded throwaway folders, and a script grades what each session did (its tool calls, in order), beside the wording gate; a rule change records a behaviour line, and a run resumes after a crash.
- The recall gate fails a rule change whose scored commit is missing, or whose graded text changed after the commit the run scored.
- The guard holds a local git act that throws away uncommitted or unpushed work (a hard reset, a forced checkout, switch or branch delete, a restore over changes, a stash drop, a reflog expire) until the owner's yes.
- A PR body or release note whose measured tokens, the file sizes behind them, or a measured wait moved carries a Visuals section: the outcome first (dollars, time or window room), a chart and a table the audits recompute.
- The test check proves tests that pass on the base by design: a planted-bug test fails on each bug it names, a forced edit's old version fails now, and a new file's fix test runs on the commit before its fix.

### Changed
- Three sections of the always-loaded rules file moved word for word to the rule files that load when they apply, and the use check fails a filled `AGENTS.md` over the new 25,000-byte cap, counted on disk.
- Sessions compact at 400K, set in the project settings; the use check fails a compact window outside 100K to 400K, and an automatic compact writes the resume packet in time.
- A closeout that ends its task marks the resume packet closed and, in a command-line session, ends with the one command to type; a resumed session whose task is closed is told to start fresh.
- Sweep reviewers run on the mid model unless a role names one; security and the novel lens stay on the top model, and every high finding is re-checked there.
- One sweep per branch: a re-sweep contract is refused with no override, and the fix check is each fix's failing-first test plus CI's test check, defined once.

### Fixed
- The guards pass a simple loop of reads and a `sed` line range, and still hold a loop that could write a guarded file.
- The PR body audits pass a tool word inside a path or command in a code span; a bare tool word in a code span still fails.
- The project launcher reads capital classes, a bracket set with a comma, chained and quoted climbs and large globs within its time limit, and names the project each reaches.
- A reinstall puts back a changed user tool with a backup instead of skipping it, a project's local overlay is merged once and then left alone, and the merge hint quotes a path with a space.
- A delete after a glued climb (`cd..`, `cd\`) is read as outside the project.
- A recall run names every read outside its probe and the user config folder, grades the kit scripts and the behaviour suite with the rules, and measures a candidate's own skills and role files.
- A session whose folder is given by its short name holds a write through a link into `.claude` or `.git`, and a user config folder under its own name keeps its settings file behind the owner's yes.
- A delete after a bare-name cd waits when CDPATH may be set, in the command, the environment or a sourced file.
- The project launcher names the project a climb through a link reaches, where bash lands rather than where the link sits.
- The kit's privacy scan reads a committed PNG by its text chunks instead of failing it as non-ASCII.
- A destructive git command whose subcommand is held in a variable waits behind a shell keyword (then, do, else, if, while, until, coproc) or an assignment, as it already did when it came first.

## 1.41.0 - 2026-11-17

The rules keep what a session must do and the command to run where a script already checks the rest, say once which instructions win, and no longer assume the owner types the code; a recall run cleans up after itself and no test file can sit outside every test lane.

### Added
- A dense screen splits what the user acts on now from what opens on demand, and is seen with real data early; a third manual repeat becomes a script, and a patch script that matched nothing fails [trial].
- The test check keeps naming a test that fails on the old code only by a crash, now held by a test in CI.

### Changed
- Rule sections a script already enforces (the merge gate, the PR body and release audits, the first push check, the commit check, sweep approval, the hand-back canary) now state the duty and the command, not what the script checks.
- One instruction order: the project's standards win for its own rules, the owner's global file for the rest, and no repo file loosens the outward-act, gate-bypass, delete or test-integrity rules.
- A local git act that throws away uncommitted or unpushed work is named first and waits for the owner's yes.
- Three project `CLAUDE.md` hard rules that repeated `AGENTS.md` now point to it; the rules with text found nowhere else stay in full.
- The test check measures each changed test file's flips in one CI slice, so the slow part spreads over the four slices with every check unchanged.

### Fixed
- No rule, template or skill still asks the owner's yes before a feature-branch push or its PR; finishing a branch pushes and opens the PR by default.
- A recall run forgets its probe folder's guard record when it ends, and a cleanup that fails is named instead of hiding the run's own error.
- A full or change-scoped test run refuses, and names, any test file no lane runs: one outside tests/ itself and tests/slow, one with another extension or case, or a linked folder.
- From 1.41.0 every build record item says whether it reaches projects or only the kit; the 1.40.0 why-line row now says kit.

### Removed
- The owner's global standards no longer assume the owner types the code: the assistant writes and runs it, one verified step at a time.

## 1.40.0 - 2026-11-16

A fix now needs a test that fails first when it is high, critical, security or an owner rule, and otherwise only when a real input shows the problem; CI states each fix test's verdict, runs the security tests once, and reads plans and rules as graphs.

### Added
- The build record keeps one row per sweep fix (severity, commit and its test), refuses a high, critical, security or owner-rule row with no test, and writes the PR's fix-test line from the rows.
- The test check states, for each test the fix rows name, whether it fails first on the code before the change, and names a fix whose test does not.
- Every test names what it guards in one why line (guards a rule, guards the owner's decision, or catches a named failure); the test check names a new test without one, and a kit test holds every test to it.
- `node .claude/plan-graph.mjs <plan>` names every pair of batch-plan units that may run at once and touch the same file, an order naming no unit, and an order cycle.
- `scripts/rule-map.mjs` lists, for each rule, the guards, scripts, tests and workflows whose code names it, and the rules only prose holds; CI fails a stale map.
- `test-run.mjs --changed --pick` prints the tests a change reaches without running them, and a unit brief takes its covering tests from it.

### Changed
- A high, critical, security or owner-rule fix ships with a test that fails before it; a low or medium one gets a test only when a real input shows the problem, and its ledger row says `no test: no real input`.
- The kit's CI runs the test check strict: a finding fails the job, and a test its time budget left unmeasured is named only.
- A PR's changed run adds the security tests itself, so each runs once, and runs the whole suite when the change reaches over half of it.

### Fixed
- The test check reads tests made in a loop, and counts a new test in a file the old code cannot load as failing first; a changed file that cannot load is still named.
- The test sort reads the tags above a loop for each test the loop makes, so the 69 merge-gate refusal tests sort as guards, not as repeats.
- A mutation run gives its tests a throwaway home folder, so a flipped line can no longer rewrite the owner's install record.

## 1.39.0 - 2026-11-16

A watcher tells the owner when a pull request turns ready, each plan now says whether it would approve itself and the loop keeps score from the owner's own answers, and one check says whether the next thread may open.

### Added
- The kit tools' `watch.mjs` shows a desktop alert when a pull request you added turns green, fails, conflicts, merges or closes; it only reads, each entry expires, and you register it once with the line it prints.
- Each plan records whether it would approve itself before the owner is asked; the loop counts, from the owner's own answers, how many such plans in a row they passed as they were, against a bar of 10. Self-approval stays off.
- `loop.mjs chain <handoff>` says GO only when the handoff passes the closeout audit, no run is open, the kill switch is off and today's thread cap is not reached; with no cap in the bounds file it says STOP.

### Changed
- Both PR body audits now require the sweep tier: the Standard review line starts with it, and a lean body opens a gate with it or with a stated exemption.
- The kill switch holds by any spelling a person makes, such as `autonomy-off.txt` from a new text file, in the merge gate and the loop.

### Fixed
- The release notes audit reads a path such as `.claude/loop.mjs` as a file name, so a draft the build record wrote no longer fails on it; a tool named in code still does.
- The merge gate audits a published PR body with the audit its shape calls for, as CI does, so a Standard body no longer meets the Lean audit.
- A loop step reads the owner's latest answer to its act, and only from a question that quotes that act alone.

## 1.38.0 - 2026-11-16

A build loop now runs under a script that keeps its steps in order, counts the stops that have a number and halts until the owner says go on, within a bounds file the owner signs.

### Added
- `node .claude/loop.mjs` keeps a build loop's state in the git folder, says the one next step, refuses a step out of order or with no evidence, and needs the owner's Yes, in the session the hooks record, after an owner's step opened.
- Fix rounds and canary misses per unit, visual increments and CI fixes are counted; at a bounds limit the run halts with a triage card (why, the data, the options) that only the owner's Yes clears.
- `.claude/bounds.json` lists the loop's steps, which are the owner's, and its limits; install seeds it once, a tool writes it only on the owner's pop-up Yes to that exact edit, and a run on a changed one waits for that Yes.
- The README says how to retire a kit project: delete its folder, then clear its record with `kit.mjs forget`.

### Changed
- Loop mode arms only when the owner's latest message is exactly the phrase, sent since it was last off; the hooks halt it on any other owner message and turn it off at session start and a compact.
- The kill switch `autonomy-off` now makes every loop step the owner's, as it does every merge.
- Recall v12: key 4 says an answer that first notes there is nothing to push yet still scores when it states the rule (the owner's ruling).

### Fixed
- Two kit scripts in one command (render, then check) are no longer held as a write to a protected file; any other node script, inline code or an option beside one still is.
- The forget of a deleted kit project now runs, and clears its record when the folder above it is gone too, while its drive answers; any other command naming it says how to clear it.
- A Yes asked before the act was tried counts when its question names the shell; the owner's latest answer decides, a Yes is for one quoted act, and one tap runs once across sessions.
- A refused resume or yes says when no session id is set, or when no transcript of that session is kept for the repository.
- The release notes audit reads a double hyphen only in prose, so a command quoted with a flag no longer fails a draft the build record wrote.
- The CI test check keeps to a time budget, says each step as it starts, and names each test it could not check instead of being cancelled with no report.

## 1.37.0 - 2026-11-16

A sweep's briefs are written from its cleared contract, each reviewer's report is checked for shape, and the findings are counted from the reports. The call cap and token ceiling now stop a reviewer in time, the cache trip counts only expired cache, and install keeps files it used to lose.

### Added
- A cleared sweep contract writes each role's brief beside it: the rules block by line range, the sweep, cap and ceiling lines, the role's diff, a scratch folder of its own and the report shape.
- A reviewer's hand-back is checked once for its report shape (a role line, one five-field line per finding or No findings, and what it did not check); the second try goes through.
- A sweep's outcome counts the findings from the reviewers' reports, writes a ledger beside the contract, and refuses a typed count that differs.
- The release check can read a verify's result file, and passes only when one number it recorded was run again and matched.
- A refused yes or resume says when the owner's Yes named the act without backticks, and `approve.mjs --tap "<act>"` checks a Yes before the owner is handed a command, without using it.

### Changed
- The read-only unit review in a team build runs at high effort, not xhigh (the owner, 2026-11-16: twice the cost found under a quarter more).
- The push bound names opening the feature branch's PR in its own definition, and an answer about pushing or a PR names both acts and the four limits.

### Fixed
- The call-cap hook stops a reviewer while the refused call and the report still fit under its cap and ceiling, counts only the calls before this one, and reserves for a growing context.
- The cache re-write trip counts only a call that read back less than the context before it after a gap of 5 minutes or more, the time the cache lives; a large batch of new results or a trimmed context is no re-write.
- A kit script followed by another command (`&& ls`, `; git status`, `; Get-ChildItem`) is no longer held as a write to a protected file; a later command that reuses its path (`$_`, `-OutVariable`, a script block) still is.
- install user names the guard record of a project folder that no longer exists, and `kit.mjs forget <folder>` removes it once the folder is gone; install never deletes a record itself.
- Status and session start name a newer release on GitHub, and a file kept from an unreleased build with the step that clears it; the install user fix line quotes the kit folder.
- Install keeps a memory file the owner's MEMORY.md still links, keeps a file the kit renamed by case alone, and never removes a file outside its folder.

### Security
- The release check lists the remote's tags only at a GitHub https address and from outside the kit folder, so no program the kit folder's git config names can run.
- The guard reads a command's braces as bash does, nested lists, signed ranges, quotes and stray braces included, in one bounded pass, so a brace list cannot hide which kit project a command names.

## 1.36.1 - 2026-11-16

A project whose improvement list is already data can now move its checkbox roadmap in, so the 1.36.0 use check has a way out. Install no longer merges a project's own state, list and decisions, and the guards close a way past them that bracketed PowerShell arguments opened.

### Added
- step move places a roadmap step before or after another, by its name or release.

### Fixed
- `list import` of a checkbox roadmap adds its rows to a list that already holds rows, with new ids, all or nothing; a box already in the list is refused, and tables beside the boxes stay in the file.
- Install seeds a project's state, list and decisions once and never merges, updates or folds them back, so a kit change to their templates never asks for a hand merge.
- A folder change back after a kit script (Pop-Location, popd, after ; && or a new line) no longer makes the guards hold the script as a write to a protected file.
- Import reads a heading step's spacing as one space, places its boxes at the step the state holds, and refuses two steps that differ only in spacing.

### Security
- A command with a bracket gets no read exemption from the guards: a PowerShell argument in brackets runs as code, and a protected path joined from pieces inside it was let through.
## 1.36.0 - 2026-11-15

The list reads as one short line per row, and every kit project keeps its roadmap as data: a hand-kept checkbox roadmap moves in once. Install checks a hand merge before it records one, and the guards stop holding the kit's own scripts.

### Added
- state.mjs list prints one short line per row (id, tag, step, severity, origin, a stored short name); `list --agent` prints one JSON line per row; `item <id>` prints the whole row; `list --full` keeps the full titles.
- Every row carries a short name of at most 60 characters: a new row must give one, and list shorten fills one in once for rows from before 1.36.0.
- list import also reads a checkbox roadmap: each box becomes a row and each version heading a roadmap step; the boxes leave the file, kept as it was in .kit/kit-backups, and a generated view shows them again.
- The roadmap template carries the generated roadmap and boxes views; the use check fails until a hand-kept checkbox roadmap is moved into the data. A new tag, blocked, stands for a [!] box.
- step rename renames a roadmap step by its name or release, and `list --step` shows one step's rows.
- A read-only `Explore` helper on `Sonnet` installs into each kit project, in place of the built-in one that runs on the session's model; a project without the kit keeps the built-in.
- CI shape templates for Node and Python projects, and ci-shape.mjs, which reports what a project's workflows lack (main-only triggers, stale-run cancel, one required check) and never fails a run.
- Status and session start flag a `claude` CLI older than 2.1.325, which fixed gaps in Bash deny and ask rules, naming npm when a package manager lags, and warn when updates come from the stable channel.
- The use check fails while git tracks `.claude/settings.local.json`, whose saved approvals can hold secrets, and while a project settings file sets disableAllHooks; the CI templates fail on the latter too.
- Session start names a user layer newer than the project and what that can break.
- Each shell command starts again in the project folder (CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR in the template settings).

### Changed
- A change to the list or the roadmap writes its views at once; an empty view block is always filled.
- An installed state.mjs run from outside any project reads its own project, and names the folder it read.

### Fixed
- The guards let 2>&1, and a plain Set-Location before a command, run a kit script instead of holding it as a write to a protected file.
- A Write, Edit or NotebookEdit aimed into a kit project from outside it runs that project's guards; one through a hard link or a network path is held.
- `install --merged` is refused on a file left unchanged since install named the merge; the same command again keeps the file as it is.
- Memory metadata the memory service adds is no change to fold back or a reason to skip an update; a file updated over it is kept first.
- list import moves only boxes markdown shows as boxes, carries a box's own lines into its note, keeps each line's ending, refuses a linked folder, and names the steps it made and the names it clipped.
- A node option that names a protected file (a warnings file, a profile folder) is held as a write.
- The CI templates' hooks step reads the settings as JSON and fails when only one settings file exists; before, it passed with hooks off.
- The testing rule no longer says a project's CI runs the guard proofs; only the kit's CI can.
## 1.35.0 - 2026-11-15

A project's improvement list and roadmap now live as data: each row has one tag, says who caught it and where its numbers were measured, and the roadmap, counts and rows are generated from it. A release is called done only when a check has read every step on GitHub and in the project.

### Added
- The improvement list lives in _List.jsonl, one row per line with one tag; state.mjs lists the open rows, adds and changes rows, and imports a markdown list once, whole or not at all.
- The roadmap table with the open rows per step, the tag counts and the rows are generated between list markers; a hand edit is refused and the check fails on it.
- Each closed row names who caught it and whether it slipped past a gate, and each number names where it was measured; list caught prints the catch rate and found to shipped by origin.
- release-check.mjs reads each release step (PR merged, main CI green on the merge commit, the tag on its files, the notes published, the state check) and names every one missing; the closeout calls nothing done until it passes.
- ci-wait.mjs reports each CI run's end in one line, green or red, with one line past ten minutes; the PR body skill starts it after each push.
- The build record writes the release notes draft, split into what projects get and what stays in the kit; publishing stays the owner's tap.

### Changed
- At the same severity, rows found in real projects rank above rows the owner asked for, then those from other methods, then the kit's own finds.

### Fixed
- A PR run that changes test files also runs the tests that read them as data, such as the pin check, so main no longer goes red on a check the PR skipped.

## 1.34.0 - 2026-11-15

A project's next action, what waits on the owner, the carry-overs and the kit version now live once, in _State.json, and the owner's rulings in _Decisions.jsonl; the Resume Point and the dashboard lines are generated from them, and a check fails the moment they drift.

### Added
- The state script keeps the next action, what blocks on the owner, what only waits, the carry-overs, the phase and the kit version in _State.json, and writes the Resume Point and the dashboard lines from them.
- What blocks on the owner and what only waits for the owner's eyes are two lists, so a note for the owner no longer stops the work.
- The owner's rulings are kept in _Decisions.jsonl with an id, the date, the owner's exact words and the reason; the words must be found in the owner's own messages or pop-up answers, or are marked as not checked. Rows are only ever added.
- state.mjs check fails when a view differs from the data, a label sits outside its block, the installed kit is newer than the data says, a committed decision changed, or a D-n pointer has no record; the use check and status report it.

### Changed
- An existing project moves its filled-in Resume Point into the data once with state.mjs init, which refuses anything it cannot move whole and changes nothing then.
- The closeout sets the state with state.mjs commands instead of hand edits, and its hand-back ends with the next item, so the coordinator can open the next thread at once.

### Security
- state.mjs never writes through a linked tracking file, leaves no temporary file behind, refuses a planted item id, and the use check runs the kit's own copy of it, never the project's.

## 1.33.1 - 2026-11-15

Install merges the kit's rule changes into files the owner filled in, line by line, and the guard that follows a command into another kit project reads braces, wildcards and quoting as the shell does, so it no longer stalls on an ordinary command.

### Changed
- Status, the session notice and fold-back say install merges changed files itself, and name the ones left to merge by hand.

### Fixed
- Install merges a file the owner filled in and the kit changed, line by line against the release it last installed, after keeping a backup. A clash, text that is not UTF-8, a guard file or a link is left alone and named.
- The guard expands braces as bash does and reads a wildcard against the real folders, so a brace, a * or a [ no longer runs every project's guards and times the hook out. A command it cannot read is held with its reason.
- A session opened through a junction or a short folder name finds its project's record.

### Security
- POSIX classes, zero-padded and stepped ranges, U escapes and a wildcard after a cd name the project they build, so its guards run.
- Install's backups stay out of git in tracked mode too.

## 1.33.0 - 2026-11-15

Install prints every step only the owner can take to turn on merge on green, ready to paste and marked done or to do; the merge gate can arm again; and PR text, repo names and a command run from outside a project are held to the same checks as everywhere else.

### Added
- Install prints the merge-on-green steps ready to paste: the allow block, the grant with its git commands, the repo settings and the branch protection for both shells. Each is marked done, to do, or not checked with why.

### Changed
- PR text is checked where it is written: a PR needs a title and body file that pass the PR-body audit and name check. A typed body, stdin, gh api or another spelling is held; repo names are checked too. Descriptions are not.
- One title standard for commits, PRs and repo names: the plain result, as merged, with no internal tracking code. Shared tech names such as SHA256, UTF8 and S3 still pass.
- Status counts main as protected only with a required check that must be up to date, no force push and no delete, from branch protection or a ruleset; the protection template requires up to date.
- Run install user and install project together: a project on 1.33.0 reads its PR checks from the user layer, and holds every PR until install user has run.

### Fixed
- The merge gate can arm again: since 1.26.0 it read only the old hook shim and said no push hold on every project.
- The merge gate's PowerShell allow lines carry the full path with forward slashes, since the PowerShell tool never runs a $HOME path unasked.
- The merge gate and status count up to date only from a source that also requires a check, read the rules 100 to a page, and name no repo when origin pushes somewhere else; check refuses a PR number with a leading zero, as disarm does.

### Security
- A command that names a kit project from outside it runs that project's guards, in any spelling of its path or name, a wildcard, a brace list or $'' quoting included.
- The PR-text audits run no program the repo's git config names and fetch nothing, since the guard runs them inside a hook.

## 1.32.0 - 2026-11-15

Before a PR only the tests that cover the change run locally and CI runs the rest; auto-fix gathers every comment first and fixes each class at its root; and a feature branch's PR opens with no yes.

### Added
- The kit's test runner prints a notice on a full local run: CI runs the suite on every PR and push, and a change takes the changed run.

### Changed
- A push of a feature branch and opening its PR need no yes: the guard lets one plain gh pr create through, from a feature branch, in a repo whose one remote is origin. Merge, release, tags and main still ask.
- One local-test rule: before a PR, run the tests covering the change, and CI's run on the push is the gate; with no CI on the PR the full suite runs once locally. The test-first, loop, team build and PR body texts agree.
- Auto-fix gathers every CI failure and review comment first, fixes each class once at its root, runs the covering tests and pushes once; every CI failure gets fixed, with no cap, and a branch has one sweep.

### Fixed
- The merge gate's disarm refuses a PR number with a leading zero, which turned the PR off but left its push held.

## 1.31.0 - 2026-11-14

Every review role stays, the plan gap check becomes a step of the plan skill, and a reviewer start is counted once and only when it runs, so a project with old guard entries can sweep again.

### Added
- The plan gap check is a step of the plan skill: one fresh reviewer reads the design and the code it changes with a fixed brief, before the owner's yes, and each high it names goes into the design.
- A feature or launch-gate sweep report counts its highs by the layer that caught them (plan, CI, sweep, escaped), and the report audit holds the counts to the highs the report lists; a report from before 1.31.0 says it kept no count.

### Changed
- The recall test names its model and effort, pinned to what the owner's sessions really run, and a test holds every team role file to a named model.
- Rule 11 and the orientation protocol name the Active Plan beside the files the Resume Point names, as the check prints them; recall keys v10 follow.

### Fixed
- The sweep guard counts a reviewer start once, however often it is checked, and never for a call another guard refused first, so a held start no longer spends its role's one slot.
- Install takes out every settings entry that runs a kit guard from its kit place, with a backup; a project's own hooks of the same name stay. Status and the session-start notice name any left.
- A sweep round whose recorded starts were refused can be closed as none ran; a start counts as refused only when its session's record shows the refusal.
- Two plain reads are no longer refused: a cd followed by piped plain reads, and a match pattern read as a command. Every planted write and delete is still held.
- The team build skill gives the scanner model's real price against the top model on both sides of a 100K-token prompt, and scanners keep their prompts under it.
- The packet writer names a preview cut apart from a missing label, so a closeout no longer looks for a label that is there.
- The protected-file guard reads a very long command about a quarter faster, so it stays inside the hook's time on a slow runner.

## 1.30.1 - 2026-11-14

The resume packet check now always names the Active Plan and every file the Resume Point names for a read, so a new session can no longer miss what waits on the owner or the real plan.

### Changed
- Write names any label or file name a check could not read, and the closeout fixes it before the next session. A label not found names its file for a read instead of the full reading.

### Fixed
- The check always names the Active Plan for a read. A pending list written on its label line, after a blank line or as numbered items came out empty, and the check then skipped the file.
- Every file the Resume Point names, up to three, is hashed and read; a file name the check cannot read means the full reading. It used to pick one link as the plan, and some wordings picked the wrong one.
- A huge tracking file can no longer stall the check: a Resume Point over 4,000 characters is the full reading, and each preview stops at 40 lines.
- The tracking check finds a Progress or Parking Lot heading with a suffix or at level three, any list marker, and a Parking Lot label; other shapes passed as empty.

## 1.30.0 - 2026-11-14

A new or compacted session starts from one checked resume packet instead of re-reading every tracking file, and the rule text held back from 1.29.0 lands now that the recall test measures it fairly.

### Added
- The resume packet: each closeout and compact saves the resume point, open lessons, git state and file hashes in about 2 KB. A session starts with one check that names only what changed; any doubt means the full reading.
- The cost rule: before a run that spends money or a shared quota, say what it costs and offer the free option first.

### Changed
- Rule 11: first the packet check, then fresh reads of what it names. The tracking files no longer load at start, so nothing loads twice: 44,288 to 32,963 bytes. Status names old start lines a filled-in project keeps.
- The owner's yes is a tap in the choice pop-up quoting the act; typed words only where the tool or model has no pop-up.
- Nothing carries to the next build by default: a low or medium finding carries only on the owner's yes, a high or critical never. The rules, the Active Plan template and the sweep guard say it one way.
- A test is owed for a change in behaviour; wording, docs and removals owe none.
- "Held" has one meaning in the guard texts, and the PR title rule counts the squash suffix.
- The recall test is version 9: question 4 asks the push and PR decision only, a new question 14 asks how a yes is asked, and keys 3, 12 and 14 follow the rules above.

## 1.29.0 - 2026-11-13

The 1.28.0 carry-overs close here, with the guard holes found on the way: a protected file under another Windows name, a write into `.git` by move or copy, and a push carried to another host. The rule text planned for this build did not pass the recall bar and is not in it.

### Changed
- The mutation measure flips only the lines a branch changed and prints the flip count and a rough minute count first. The whole kit runs only when started by hand with scope set to all. A bad base stops the run.
- The guard timing tests keep their 8 s limit by the clock on a machine of normal speed. On a machine measured slow the guard's own work is held to 8 s, so a slow runner no longer fails them.
- Each of the 25 flipped lines the 1.28.0 measure left alive was built and run: 14 now fail a test, 5 are shown equal by 13,048 compared readings, 6 are equal by what reads them. Three restated test lines were cut on the owner's yes.
- The test check names a rule that a change itself adds to the rule index; the link scan, a CI gate with no failing case, has a test; a used pop-up yes is tested not to answer a second ask.

### Fixed
- In PowerShell a wildcard under plain folders (`tests/*`) is no longer held as a write to a guard when the folder holds no dot name, no link and no kit file at any depth. Only for a one-statement command of plain text.
- A project whose path is over 200 characters is found by the session folder name as it is shortened; two such projects alike in their first 200 characters are held, not guessed.

### Security
- A protected file named with dots or spaces on its end (`settings.json.`) or a stream suffix (`guard.cjs::$DATA`) is read as the file Windows opens. On 1.28.0 PowerShell could write the settings or a guard that way with no hold.
- A move, a copy or an unpack into `.git` itself, its worktrees or `.ssh` is held, as a write to `.git/config` or the hooks always was; so is the config folder under a name of its own.
- A device or share spelling of a local path (`\\?\C:\...`, `\\localhost\C$\...`) is read as the local path, and one that cannot be placed is held while a project lists folders. A shell word through a link is read as the file it reaches.
- Changing what carries a push (`core.sshCommand`, a proxy, the certificate check, the credential helper) asks for the owner's yes, as changing the URL does. A feature push asks when origin pushes to another repo than it fetches from.
- The folder list `.claude/protected-folders.json` is never written by a tool, and install records it outside the project: gone, changed or not yet recorded, every call is held. The owner accepts a change in their own terminal.
- A PowerShell listing piped into a writer is held when it is recursive with no folder named, uses `-Exclude`, or filters by a pattern that fits a guard file's name, in every form PowerShell takes for the parameter.

## 1.28.0 - 2026-11-12

Every guard reads each command a second time, written one way, so every spelling of a gate bypass gets one kind and plain reads stop being held (T16b). The 1.27.0 carry-overs and the review's security findings close here.

### Added
- A project can list folders in `.claude/protected-folders.json` (`{"folders": ["<path>"]}`) that no tool writes into; the owner writes the list, and a malformed list holds every write and shell call.
- `kit.mjs scratch new|keep|clean` records a thread's probe folders, and closeout removes the thread's own with no ask: to the Recycle Bin on Windows, to a .trash folder elsewhere, kept folders exempt, old strays listed.

### Changed
- Kit CI decides scope and the install lane by the base's own rules, runs the test check in four slices, and counts a why tag only when it names a rule the kit has.
- The install check holds every planted bypass and each 1.27.0 spelling to its kind (never, or the owner's yes), from another repo and with no project named, and checks the false holds this build fixed run.

### Fixed
- A marker named only in a read, a print-only sed, or a commit or gh message is no longer held as a bypass; plain reads of a guard file pass in the shapes found.
- In bash, a test run naming `tests/*` is no longer held: a wildcard at the start of a name never matches a dot name there. PowerShell, quoted or escaped wildcards, and dot globbing still hold.
- A hook shim over a launcher older than 1.26.0 stops and names install user; a project at 1.28.0 needs the user layer reinstalled first.
- The PR body audits count the squash suffix in the title (8 when no number is given) and take the PR number as an optional third argument, which CI passes.
- A build record is checked for what the PR body audit would fail, so it never writes a body that fails.
- The first push check's scanning call names github.com as its host.
- The settings guard reads the user folder once per call; each guard call now takes about half a millisecond.
- The install check test runs the working tree, and the install and status tests the 1.27.0 cut lost are back.
- The merge gate counts the PR title with the PR's own number, as CI does; a scratch folder that cannot be moved keeps its ledger line and the report of what did.

### Security
- Every spelling of a marker clear or a hook move the 1.27.0 sweep found is refused as a gate bypass, never asked: appends, setters, env and exec forms, `printf -v`, and a marker name built at run time.
- Every guard (settings, delete, task and push) reads the second reading beside the text; a git or gh script wrapper such as git.ps1 is read as git, so a delete or commit spelled that way is held as git is.
- A push typed in the owner's terminal tab is outside the push bound, and a shell fed a script on its input (base64 -d | sh, sh -s, sh < file) is held unless the script is written out in the command.
- Pre-push holds a push to a remote it cannot ask for its default branch, and the first push check reads only a checkout git lists, so a folder pointing at the repo cannot clear it.
- A marker name piped into a program that is not a reader is a marker clear; a reader named by a path gets no read exemption; a sed w command glued to a guard, settings or listed path is held.
- Closeout and the load check start the system PowerShell by its full path, never one in the current folder; the recall scorer cannot read /proc or the command line tool's sign-in.
- A feature push from a repo whose git hooks are not the kit's (another repo, a nested repo, a submodule) needs the owner's yes, since no secret scan runs there.
- A feature push the guard cannot place, with no project folder or no folder for the call named, asks the owner.
- Moving the local origin/HEAD is held; pre-push takes the remote's own answer for its default branch, and a remote that names none holds the push.
- The first push gate asks the remote what it already holds, so a local remote-tracking ref cannot end it.
- The first push check reads only the repository it runs in.
- The push scan reads every file and name in a tag that points at a blob or a tree.
- A settings write that turns every hook off is refused, even with the owner's yes.
- The recall job runs the candidate, the baseline and the scorer on three machines; the scorer reads only its desk and takes each job's runs by name and exact file.

## 1.27.0 - 2026-11-12

Tests and CI (T15): every kit test says why it is kept, 29 that guarded nothing new are gone, a script holds new tests to the same bar, and a PR runs only the tests its change reaches. The 1.26.0 carry-overs and guard rows close first, three of them security holes; C17 moves to build 3 after its recall run fell under the bar.

### Added
- The use check says whether the latest pop-up answer carries the field the guards read.
- The first push check names a public GitHub repo whose secret scanning or push protection is off.
- A test check holds each new or changed kit test to the bar (fails first, earns its place, right lane, owed at all), as a report in CI.
- An install check in CI installs this build, upgrades from the previous release, and replays every command the push guard's proof holds through the installed launcher, on Linux and Windows.
- One build record per release writes the changelog entry and the PR body, and CI checks it on every PR that moves VERSION.
- The recall test can run in CI by the owner's hand from main, reaching the model through workload identity federation with no stored key; it reports only, and stays off until the owner sets it up.
- Every kit workflow is linted in CI, the linter pinned by its checksum.

### Changed
- Every kit test carries a why line: the rule it guards, or the break only it catches, written from a CI measurement of 2,326 code flips.
- The kit's PR CI runs the tests its change reaches plus the security set, and the whole suite when it cannot be sure; every push to main runs the whole suite and keeps the map the next PR selects by. A body edit reruns only the PR body check.

### Fixed
- The pre-push hook asks the remote for its default branch and whether it is new, so a local ref cannot fake a first push.
- A reinstall holds a guard file a later release adds until the owner accepts it, moves records from the old long names, and rewrites the hook shims of every recorded project, except one still on an older kit, which it names until that project runs install project; a changed or slow kit hook says why it did not run.
- The task gate lets a command that only prints git commit through, and still holds a substitution inside a printed line.
- Settings deny git log, diff and show with --output anywhere in the command.
- The owner's yes is found at the end of a transcript too long to read whole.

### Security
- The guard holds a push whose hooks were moved by an included config file or another git folder, a write to main through the GitHub API in any encoding, and a push run outside the project's work tree. A release install refuses a release with no tree to check against, and checks the kit's config and version files too.
- Clearing the AI shell markers (CLAUDECODE, AI_AGENT) before a command is a gate bypass, refused even with the owner's yes (the owner's lock).
- An owner's yes answers one act in one shell: a shell act needs a held try before the pop-up, and an edit whose text holds a separator gets no yes.
- The secret scan reads commit and tag messages as raw objects, every tag in a chain, and ref names.
- Git hooks run from the copy the launcher checked against the install record, never from the project folder a tool could write.

### Removed
- 29 tests whose every caught flip another test also catches, after the owner's yes; every caught flip is still caught.

## 1.26.0 - 2026-11-11

Guard wording (T16a): one name for each thing, one home for the push bound, one voice for every refusal, and gate
bypasses as their own kind. The 1.25.1 sweep's carry-overs are closed first. No guard reads a command differently.

### Changed
- Every refusal opens with its kind: "Owner's yes needed", "Hand back" (a subagent), "Never by a tool" or "Held" (a
  guard file or setting is not as install left it). A held push names the limit it hit (main or master, a tag, a
  force, a delete, not a plain push to origin) and the act to quote, with the marker the pre-push hook needs, so one
  pop-up covers it.
- A gate bypass (skipping the git hooks, moving the hooks path) is refused even with the owner's pop-up yes, as
  settings.json already refused the plain spellings (the owner's lock), wherever it sits in a command: behind a push,
  the push marker, an alias body or another command.
- An AI push to main, master or the remote's default branch is refused, whatever the yes, once the remote has that
  branch: it takes a PR. Only a new repo's first push goes there, with the owner's yes. The pre-push hook reads this
  from the remote's own answer during the push, so no local ref can fake a new repo. This decision change was added
  to the wording build on the owner's word, 2026-11-11. A write to main that runs no pre-push hook (git send-pack, a
  ref write through the GitHub API) is refused outright.
- Five names in rules, skills, agents and guard texts: the owner's yes, outward act, the push bound, gate bypass,
  protected file. A word check in CI fails the old names for the owner's yes and an outward act.
- The push bound is written in full once, in rule:outward-acts, with its four limits named every time it is
  stated (never main, a tag, a force or a delete); non-negotiable 6 names the four and Hard Rule 14 points to it
  (the owner's locks).
- Kit memory carries three owner preferences: nothing by hand, a short status at each step of long work, no
  throwaway drafts in the project library (N15).
- A first install holds every call while a project keeps its own file where the kit ships a guard file, until the
  owner runs install project --accept-host for it in a terminal (the owner's lock, B16).

### Fixed
- The guard loader takes from the Claude config folder only the kit's own hooks, with the bytes install user recorded;
  a kit hook in the old one-process shape runs only from those checked bytes.
- Every git hook shim checks the guard files before it runs a project hook, so a hook a branch carries never runs in
  the checkout that brings it. Shims for the server-side push-to-checkout and proc-receive are gone, and a file in the
  shims folder that install did not write holds every call.
- A host hook the owner accepted stays accepted, so one that differs between branches no longer holds each checkout.
- A release install copies only bytes that match the release tag's own tree, so a file swapped after the release
  check is refused, never copied.
- Record names are cut to keep shim paths under Windows' 260 characters; a short path keeps its record.
- The kit gate names a recorded node that is gone, and the command that repairs it.
- The kit pin covers a kit folder that is a git worktree.
- status runs the launcher's own check: a swapped shim, an added .githooks hook and a changed hooks path are gaps.
- The agent-teams rule names the hook shims as core.hooksPath; the tests run hooks in Git Bash on Windows; the sweep
  check's hooks-off clause has a test; the 1.25.1 changelog's PATH line is corrected.

### Known limits
- A process that can move the kit folder's release tag can still choose what a release install copies, and the kit
  config and owner profile are read before the tag check.
- "A new repo's first push" is judged per branch: a remote with other branches and no main still takes a first push
  to main on the owner's yes.
- The pop-up block in each "Owner's yes needed" refusal is unchanged: shrinking it waits for build 2's planted-case
  job, which can measure whether sessions still build the pop-up right.

## 1.25.1 - 2026-11-11

V3: the guard files are checked from outside the project before every call. In 1.25.0 a patch, a branch, a stash or
a script the agent wrote could replace them, and the replaced guard then passed a main push.

### Changed
- One launcher in the Claude config folder runs the guards on every tool, wired by install user. Before each call it
  hashes the project's guard scripts and git hooks against a record install project writes beside it, outside the
  project. Any difference holds every call until install project puts the kit's copies back; that install line may
  run alone while held. With none, it runs the project's guard from the bytes it just hashed.
- The project's settings.json no longer runs guard.cjs itself. Run install user before install project.
- A settings change that sets "disableAllHooks" (which turns off every hook, the user's own included) or removes the
  launcher is refused mid-session, and every call is held while a project settings file carries the key.
- core.hooksPath points at hook shims beside the record: they check the guard files, then run the project's
  .githooks, so a hook swapped by a branch cannot pass the push in the same command.
- Every script in a project's .claude folder and every git hook is a guard file now. install project always puts the
  kit's copy back, keeping the project's edit in the backup folder; status reports a changed one, or hooks turned off,
  as a gap; fold-back shows its diff but never offers it to the kit; the use check reads the new wiring.

- The launcher starts from a shell line that clears NODE_OPTIONS and names node by its full path (the git hook shims
  also put node's own folder first on PATH): a settings
  env reaches every hook process (proven live), so a project's env could otherwise load code into it. A project
  settings env that sets NODE_OPTIONS, PATH, a GIT_CONFIG key or another key that changes how node, git or the guards
  start is refused mid-session and holds every call while it is there.
- The hooks path is read the way git reads it (a second value, an include, a worktree config), and a tool may not
  write .git/config.worktree, the install record or the guard records, by the config folder's own name too.
- The hook shims cover every git hook: a host that keeps its own hooks in .githooks keeps them all. A git hook the
  host tracks and the kit never wrote is left as it is, reported, and guarded as it stands.
- install project takes the 1.25.0 guard entry out of a settings.json the owner changed, keeping the rest and a backup.
- After install user, a project whose kit scripts were edited is held on its first call until install project puts the
  kit's copies back; the hold names the files and the one install line that may run.
- A launcher that is missing or cannot load blocks every tool call in every folder (the owner's pick: a broken guard
  never lets a call through), and the kit gate says so on every prompt, with the install user line that repairs it.
- A host's own git hook that changes after it was recorded stays held through a reinstall until the owner accepts it
  with install project --accept-host <file>, which the held fix line may not carry.
- The sweep's hook check (approve.mjs) reads the call cap and sweep guard the launcher runs, not only project settings.
- The held fix line is matched exactly: the recorded node and the kit script as full paths, the project, and at most
  --force, on one line; --unreleased is gone from it. It runs only while the kit folder (files and git config) matches
  the fingerprint the record keeps, so a kit folder changed since the install cannot record a swapped guard as good.
- install runs every git with fsmonitor off and no transport allowed, from node's own folder, so neither a project's
  git config nor a git.exe left in the project runs inside the held fix line.
- The merge gate reads the push hold in the project hook the shim runs.
- The old guard entry comes out past a byte-order mark, and out of settings.local.json too.
- A hook added to .githooks after install, or a guard file reached through a junction or link, holds every call; the
  guard process loads only the bytes it checked and the config folder's own hooks.

### Known limits
- A script that also rewrites the Claude config folder; only an admin-owned managed settings file would close it.
- A session started after "disableAllHooks" was already in a project settings file runs no hooks; the git hook shims
  still refuse every commit and push there, and status names it.
- A payload that acts inside the same command that planted it, and a process left running that changes the kit folder
  between the fix line's check and install's reads.

## 1.25.0 - 2026-11-10

The guards hold against the six ways around them found in 1.24.0, and the owner's yes is a tap in the choice pop-up.

### Added
- One guard process runs every PreToolUse check, and a missing guard blocks with the fix.
- The owner's yes and the sweep's yes and resume come from the choice pop-up record.
- A plain push of a feature branch to origin needs no yes; the pre-push hook bounds and scans it.
- Two test lanes: a slow lane beside the fast one, both required, and a lane-state report. No test is in the slow lane yet, so it skips today.
- The use check: each kit part is present, wired and used; install finishes only when wired. A settings.json you changed is not overwritten: merge the kit's PreToolUse entry by hand, or install again with --force.
- Templates for the changelog entry, the decision pop-up, the 60-second overview and thread rules.
- Recall ruler v5: question 11 asks for the rule, key 4 names the push bound.

### Changed
- Commit subjects and PR titles are `type: subject`, at most 72 characters, checked in CI.
- The Standard PR body drops the file list and gate folds; review rows come from the project.
- Junction tests run on Windows and Linux both; the runner reports tests skipped off Windows.
- The task gate counts only this project's rules read and skips lists, help and label edits.

### Fixed
- The delete guard lets look-ups (man, which, type) pass.
- The guards read a 98 KB command inside the hook's 10-second limit; it took 21 seconds before.
- A user layer still on 1.24.0 keeps its agent-team hooks running until it is reinstalled.

### Security
- Pushes to main, tags, forces and deletes are held unless the owner tapped yes for that act.
- Skipped hooks, a moved hooks folder, a changed origin and writes to guards or settings are held.
- `curl` uploads of files are held, and the secret scan reads every pushed commit.
- Owner-proof refuses a write through a variable it cannot read whole, or a wildcard on a guard.
- Windows short names, a program redefined in the same command, defaults like `${X:-.claude}` and the push and sweep logs are held.
- One pop-up yes runs its act once, only from a plain Yes, and only in this folder's sessions.
- The secret scan asks the remote what it has, reads diffs by hunk, and knows 8 more key shapes.
- `--no-verif`, a remote's push refspec, curl reading `@file` or its config, and wget's `-e` are held.

### Removed
- Typed approval codes: the owner's yes is the pop-up tap.
- The delete guard's exemption for files made by mktemp.

## 1.24.0 - 2026-11-10
- Tests check behaviour instead of sentences, CI runs on Linux, the owner's yes holds against a spelled-around guard, and fewer prompts reach no one. Practical tests (E31): a test pins exact words only when the words are the behaviour (a machine reads them, a guardrail's order at a stop, frozen text, words the owner locked), and says which with "pin: <n>"; a new pin check fails any whole sentence of 8 or more words pinned without one, and 142 such pins were repointed to the tokens a reader acts on or named by case (rule:word-pins). A new test stays only if it fails first and catches a mutant or guards a security or owner rule; a sweep fix that is prose, wiring or a removal adds no test (rule:test-value). Every test run and mutation check now gives its tests a throwaway Claude folder, so a test that loses its own (a mutant, a slip) lands there and never in the owner's: a Windows mutation run had rewritten the owner's install record (its files stayed the released ones). The recall gate no longer reads a recorded line as removed when appending an entry only adds the file's missing final newline; a line that changes is still a drop. The mutation check ran before and after the repointing: both runs stopped early when WSL ran out of memory, and on the 365 flips both reached, every one caught before is still caught. CI runs the suite on Linux (623 tests in about 20 s on the owner's PC through WSL, against about 7 minutes on Windows) and on Windows only the tests marked { windows: true } (drive paths, Git for Windows' sh, junctions) and both guard proofs; the required kit-tests check fails unless both jobs passed. A yes or a resume with no thread message now needs a real terminal, where the owner types the code (S23-4): with the AI shell's two variables cleared, a variable or a glob spelled both past the outward guard, and approve.mjs logged them; the outward guard also asks on any command that clears CLAUDECODE or AI_AGENT or the whole environment, PowerShell's wildcard, filtered and .NET removals included. The thread proof reads only the running session's own transcript (S23-5), and a session id no file can carry reads none. Remote Control prompts: in a subagent the delete and outward guards refuse instead of asking, so the agent hands the command back rather than waiting on a prompt no one sees (80 of the 518 guard prompts in the ten days before this build were in subagents); here-document bodies stay read as commands (reading them as data opened three bypasses in the sweep), and narrowing the delete guard's lead-session prompts is carried. The owner-proof guard now follows a cd (it never did: the last command's empty break read as not plain), a variable set earlier in the same command, and a cd into the transcripts, so reads there pass and writes are refused; a file whose text only names kit-owner.json passes (S23-1, S23-2). A task gate (E30) holds a PR, a commit, a tag or release and an agent fan-out until the session has read that step's rules since it started or last compacted, as a refusal, never a prompt, and counts a read only by the Read tool or a reader program. 2.36 KB of repeated text left the start load (the memory-bank table, the subagent list, the start file's generic tree, recovery and templates), short of the 9 KB planned: the rest is the owner's locked Rule 14 text and a rule a released recall key checks, which stay word for word. npx cancels instead of installing a missing package without a prompt (N10). E8: the rules hold no new logical-yes stops (audited). The sweep guard refuses to message an agent whose type it cannot read, or a reviewer addressed by its name (F36), and the call cap and token ceiling come from the brief alone (F37). Carried by decision: F29 (logs from before 1.23.0 only), F34 (keeps a root, never removes one), F35 (install copies; a failed step is named, nothing live changes); S22-2 (not inflated: a table loop registers one test per row, as merge-gate's two tables and the pre-push pair do; a file without loops reports one pass per test); S22-8 (no 8.3 names on this machine); S22-9 (fix forward). Changes to note: the project settings add the task gate and npm_config_yes=false (merge them in by hand if your settings changed); the kit repo's main now requires the kit-tests check and an up-to-date branch (S23-3).

## 1.23.0 - 2026-11-08
- Sweeps stay in budget by a bound, not a guess, the owner answers asks and pauses from the phone thread, and CI has room again; each 1.22.0 carry-over is closed or carried by name in the sweep report. Each sweep role gets a token ceiling: the p90 of the last 60 roles the repo's log measured (1.25x the role's budget until 20 are; a crashed reviewer's retry counts alone), carried in its brief as "Token ceiling: <n>"; the sweep guard refuses a brief without its role's own, a sweep the owner cleared included, and the call-cap hook stops a reviewer while one more call still fits, so its report still arrives. Once the decision's ceilings come from that baseline, the whole-sweep 25% trip gives way to drift signals, each by name: a ceiling or call cap that did not hold, more than a third of roles stopped by the hook's own refusal, the starting context 10% over its median, content per call over its p95, two or more cache re-writes; the model check stays. Each outcome logs a role's token split, starting context and whether the hook stopped it, so a dollar ceiling can follow. A new mutation check (scripts/mutation-check.mjs) flips one condition at a time in the lines the coverage map ties to tests, runs only those tests (and any proof script named with --also) in a scratch clone that shares none of the repo's config, refs or hooks, and names every flip none catches; its first run found four decoy brace groups hiding a push from both guards (now every group is read). A release verify script (scripts/release-verify.mjs) runs flow step 6 on the owner's PC and stops at the first failed check. A cloud session cannot clear a sweep or install the kit. The owner answers from the phone thread (E27): approve.mjs --owner-yes "yes <code>" --thread <message id> and --resume --thread <message id> read the owner's own message from the session transcript Claude Code writes, only from the sender kit-owner.json names in the Claude folder install filled in (threadYes false turns it off), only from a project thread turn in this repo and never a relay, a cited copy or a subagent, sent after the ask or pause, the whole message exactly "yes <code>" or "resume <code>" with the code the ask or pause prints, and once; without that proof a yes from an AI tool's shell is refused. approve.mjs --owner-setup names the owner from the thread the first time: it gives the words to send ("setup <code>"), and --owner-setup --thread <message id> writes kit-owner.json with that message's author. No agent may run any of these. A new owner-proof guard, shipped in the project layer, refuses any tool write to the transcripts or kit-owner.json, in any spelling a shell reads as them (., //, a wildcard, a short name, a cd into the Claude folder), while reads, copies out and commit or PR messages that name them pass (a path built at run time stays unread, as for every guard); the outward guard asks on a resume without its proof in its own command, and a --thread proof behind a comment proves nothing. CI splits the suite over four parallel runners with one named shard count; the required kit-tests check fails unless every slice passed. The guards now read cmake -E rm, remove and remove_directory (and -E chdir), sequence and nested brace groups ({r..r}m, {push,{origin,main}}), npm's later --no-dry-run, --dry-run=false, abbreviated and value-taken dry-run flags (and --DRY-RUN as the unknown flag npm reads it as), -B for -Body, git fed its subcommand by xargs past option values or through -I, git svn and git p4 writes, git config and cargo aliases set from the environment, docker, podman, cargo, twine, gem (and its short command names) and nuget publishes (a docker build that pushes included), scp, and rsync to any word with a colon; a command too long to read asks before it is read. Status and session start flag a Claude Code older than 2.1.295, where a guard that crashes lets its command run, and read the version without running a program from the current folder. A finished reviewer cannot be resumed by SendMessage; a rebased and renamed or detached branch still counts its first sweep; the merge gate reads a hooks path set through the environment; checkers and builders run nothing in the background; the temp sweep keeps a dead run's root while a run nested in it lives, and kit-temp writes down its pid-space and clock-jump limits. Carried, not built: fewer Bash permission prompts in Remote Control (the prompts left are the auto-mode classifier's, which reach the owner only through the thread). Changes to note: the project settings drop the --owner-yes ask rules and wire the owner-proof guard from the project layer (merge them in by hand if your settings changed); a sweep brief needs its "Token ceiling: <n>" line from the start notice; the thread yes is now exactly "yes <code>"; test-run --slice needs --shards and takes no --map; rsync to a C:/ path now asks.

## 1.22.0 - 2026-11-07
- Tests stop leaking temp folders and run in parallel, the 1.21 carry-overs close, and a branch gets one sweep. Every test temp folder goes through one helper (kit-temp.cjs) under a root named for its run, removed at exit and on a kill; each run first clears roots whose process is gone or that are older than a day, and refuses to start above 80% inode use (kit status warns above 50%). node scripts/test-run.mjs runs the suite in parallel shards (280 to 340 seconds over 8 shards on the owner's Windows PC, against about 13 minutes run one after another) and checks that no temp folder is left; --changed runs only the tests a coverage map ties to the changed lines; CI runs the full suite. The lean PR-body audit, the canary and every gh call the merge gate makes have real tests, the gh answers recorded from the real gh. Both guards read a command through one shared reader, and now also ask on tar --remove-files and its prefixes, zip -m and --move, pythonw, folder changers, find over a folder holding .git, git send-email, git through xargs, package publishes (an option's value before publish included) and HTTP writes (curl's clustered flags, PowerShell's colon-bound and prefixed parameters), and the outward guard reads a command handed over by a here-string, a redirect target or a backtick span. cmake's delete forms stay unread, carried to 1.23.0. The merge gate matches clearings on the full commit; requires the base's strict up-to-date check, adapter row A27 on the base listing merge as its own item (a row that says no merge grants nothing; the row's file is now protected), a PR that is plainly not a draft and not a fork, a clean working copy (an edit hidden by an index flag included) and the push hold in place; counts only the branch's own changes after the sweep, so taking main is no change, while a fix after the sweep leaves the merge to the owner; logs an arming it could not read back; stops on a planted tool in live; pins PR_BASE for the body audit; and pushes autofix only to one push URL that is exactly the PR's host and repo, in a remote form (a bare path named like the repo is a local folder to git). merge-gate.mjs status shows the kill switch and each PR still armed, and its header names four limits it does not close. One sweep per branch (the owner, 2026-11-07): a re-sweep or any second sweep asks the owner, found by branch name across a rebase; every fix ships with a test that fails first, and CI is the gate. An outcome counts only the reviewer the guard started for each role; the guard refuses a brief carrying a call cap under another agent type, a reviewer outside git, and any start after a hand edit to the log; approve.mjs needs the sweep guard wired with hooks on in every settings layer, counts work kept beside the contract, reads the base by its full ref, logs a crashed reviewer that lived on, and a rerun keeps a live clearing. A reviewer reads a file over 40 KB by range and runs nothing that waits past 5 minutes. The rules carry the one-sweep loop, CI as the full run, the stalls to avoid (a command an agent may run, a prompt not seen), owner text word for word, and a closeout count toward a self-audit every 10th feature build. Changes to note: the merge gate refuses a base without the strict up-to-date check, and a project whose row A27 still reads none (the default) gets every merge refused until the owner merges a row that lists merge; sweep approvals logged before this release need clearing again, and on a branch already swept that clearing is a second pass, the owner's. If your project filled in its adapters, merge the reworded lines by hand; docs/migrations/1.22.0-reworded.json lists them.

## 1.21.1 - 2026-11-06
- The merge gate reaches its checks. 1.21.0 asked gh for a repo field that does not exist, so every check and arm stopped with "gh could not read the repository" and no merge could pass the gate; it failed closed. The gate now reads the repo settings from the REST repo, and a test checks every --json field against the real gh; the fake gh in the tests answers a PR read with only the fields asked for and matches paths whole. REST fields are proved by a live check, not a test. With the gate past that point, two reviews found it could be misled, so it now stops when the repo it read is not the PR's repo on the PR's host, and it fetches the base by a full refspec, holds it to the tip GitHub reports and judges that sha. A base that does not match stops the run before any audit runs, live pr holds to the same tip, a grafts file stops the gate, and replace refs and diff settings in the repo are ignored. A login that cannot read the settings is told so, rather than told they are off. A live check on real PRs runs every check; a live arm has not been run yet.

## 1.21.0 - 2026-11-06
- A merge can run without a yes per merge, on the owner's grant, and the 1.17.0 to 1.20.0 carry-overs close: 32 of the 35 by fixes, and three by decision (row 8 asks on purpose, row 15 waits on E13, and two items of row 21 stay as designed). A merge gate (~/.claude/kit-tools/merge-gate.mjs, written by install user outside every repo, so no branch can edit the gate that judges it) arms GitHub auto-merge on one PR only when fixed checks pass: the kill switch is absent, the PR is open and from this repo with the working copy at its head, no changes requested, no hold label, no failed check and no optional check still running, the repo allows auto-merge and branch deletion, the base requires a status check, the diff touches no gate, grant or loaded-rule path (in the kit source, its tools, rules and tests too), the approval log cleared a sweep at the head, its report passes, gives the version goal as YES, and every high in every report on the branch names a real commit in it, and the live body passes the audit, from the base or else the copy install user keeps in the user layer. A stop someone set on GitHub holds until the owner clears it. Anything else writes a triage file and stops. The grant is allow rules the owner adds to their own settings, for arm, disarm and autofix; without them each asks. disarm stops a PR already armed, which the kill switch does not reach. Auto-fix stays a push grant: autofix makes the push itself, moving only the PR's branch forward, disarms first, logs the commit that went out, and stops on the kill switch; only the owner's or their review tool's comments are in scope, and that bound is a rule, not a check. GitHub documents no head pin past a writer's push, so the pre-push hook refuses a push over a head still armed; this is a fail-safe, not tested live. Nothing tells the owner of a merge that lands after the session goes idle until E13 ships. The gate has no preview check: the auto-merge line no longer names the preview test, so a user-facing PR's preview stays a step before arming. The gate also audits a live PR or release body. Every repo, private included, turns on auto-merge and branch deletion once it exists, auto-fix stays on while the owner is away, and the kit source checks its own commit messages at commit. The delete guard closes the holes the 1.20.0 review and the 1.21.0 sweep found: git aliases defined outside the command, quoted or escaped subcommands and delete words, wrappers, xargs, programs in a variable behind a wrapper, PowerShell parentheses, links past a wildcard, other spellings of .git, Start-Process lists, find -exec, find -- and backslash-newlines now ask, and a commit message or search that only names robocopy does not. Both guards now read each command through one plain reading as well as the text as written, so escapes, braces, odd spaces and curly quotes are read once for every rule. The guards are a net for slips: a value built at run time stays unread. Not covered yet: tar --remove-files, cmake, zip -m, scripting launchers such as pythonw, and the medium findings the 1.21.0 sweep rolled to the next build. It finds a session's own temp folder by its id alone, a full UUID under exactly one key folder, since Claude Code moved that key from the path slug to a hash and every delete there had started to ask. The sweep audit reads an indented findings table. Each reviewer's brief carries its sweep and role, one owner yes answers one ask, a re-sweep gets its own floor, fixes that change more than max(50 lines, a quarter of the first sweep's diff) ask the owner, as do a third pass and a base off the default branch. A reviewer that crashed gets one retry for its role (--retry <n> --crashed <id>) once its transcript has been quiet for 10 minutes, and the crash's tokens count against the role's budget. --outcome --agents auto finds the reviewers from their briefs, so ids lost to a compaction no longer end a sweep. A clearance closes at its outcome, each start must carry its role's question and run from, or name, the cleared checkout, a brief naming a sweep must run as a reviewer, --none-ran reads transcripts as well as slots, and --owner-yes asks, by the shipped settings and the outward guard in any spelling it can read. Recall keys v4 align key 3 with its rule. CI now runs the base branch's recall gate, so the control's median sits on its own line beside the gate line, and recall refuses when the CLI reads another config folder than the layer it checked. The blind and score tools live in the repo (scripts/recall-score.mjs); a median of 3 landing on the bar holds the line until a median of 5 decides; a throwaway recall layer must be a real install and records the global layer it loads. A closeout that started on its own asks before a remote delete. A handoff's first action is the next build with its carry-overs riding in it, and a fix goes first only when high or critical. The audits catch the rarer attribution forms. The tests keep every temp folder under one root removed at exit; they had left about 167,877 folders in the temp folder. If your project filled in its adapters, merge the reworded lines by hand; docs/migrations/1.21.0-reworded.json lists them.

## 1.20.0 - 2026-11-05
- Fewer stops for an answer the records already give, and rules that match the guards. A session starts the first action its handoff or a confirmed work order names, except what hits a stop or waits on an open owner decision, and asks only when neither names one; the feature for a run is the work order's next item; a blast-radius check asks the owner only when a fix reaches shipped code outside the branch's scope or a public interface; leftovers and findings that arrive after a PR opens go to the handoff's carry-overs for the next focus build, and a high or critical never carries unless the owner accepts it. The closeout also starts on its own once the thread's PR is merged, its Post-Merge Check is done, any planned release is out and the thread has no other work open; the keyword still works. The temp-file step deletes only inside the session's own folder and lists anything else for the owner, and the delete guard asks on a delete outside the project and that folder. The version bump is on the branch before the PR opens. A high or critical sweep finding is fixed or accepted, never carried: the sweep audit fails one marked DEFERRED. The delete guard now also asks on a git clean it cannot read as a dry run, an alias set in the same command that cleans, removes, hard-resets or runs git worktree, and robocopy with a removing switch or a job file written with /, // or -. AGENTS.md carries the reuse habit (scan existing code for patterns to reuse), and the template _Start Here.md keeps a two-line How We Work. If your project filled in its adapters, merge the reworded lines by hand; docs/migrations/1.20.0-reworded.json lists them. Recall keys v3 add three questions (temp files, carrying a high finding, what starts the closeout), and the pass bar is a median of 12 of 13; CI now fails a recall median under the keys' pass bar.

## 1.19.0 - 2026-11-04
- A brainstorm skill digs out what the owner expects before any plan, sized to the work: chat for one or two questions, a plain sheet file from three up, with a page as an optional view. A script compiles the answers into a record that copies the owner's words exactly and keeps a confirmed pick apart from them. plan-feature hands its questions to it. Decisions and build threads open with a plain 60-second overview, item codes only after the plain name [trial]; a scenario test found sessions do not yet follow it, so it stays open. The PR attribution block is gone: attribution.mjs is retired from installed projects, and the PR-body and release-notes audits fail on the hidden comment or a Requested by line. recall.mjs makes its own random folder, so a folder's name cannot lift an answer (new usage: <label> [kit folder], or <label> --no-kit for the control), and removes its folder after. Two lines left _Start Here.md to stay under the session-start cap. If your project filled in its adapters, merge the reworded lines by hand; docs/migrations/1.19.0-reworded.json lists them.

## 1.18.0 - 2026-11-04
- The recall gate measures the rules on one ruler, and CI enforces it. The rules now name where approve.mjs lives (~/.claude/skills/pre-pr-sweep/, $HOME in PowerShell, or the Claude config folder) and what its absence means, and the pipeline line says the PR body carries the sweep summary. Recall keys are versioned: v1 stays frozen; v2 matches key 7 to the rule and asks question 3 in the third person. The scorer brief is committed (docs/evals/recall-scorer-brief.md). recall.mjs records the keys, both kit versions and whether approve.mjs is there, and refuses a run when the Claude folder is not a released install. CI reads the PR's gate line: rule text, a key, the brief or the harness merges only with a gate line on the current brief and keys, with a median no lower than its baseline, a baseline no lower than the last recorded, an unmoved ruler and no recorded line removed; an owner-accepted marker passes all but the current-ruler check. Median 9 stays the target. A project that filled its adapters keeps its own standards files: merge the reworded lines by hand (docs/migrations/1.18.0-reworded.json lists them).

## 1.17.0 - 2026-11-03
- Sweep auto-approval stops asking the owner for what Claude can fix, and budgets follow the work. A mistake in a contract now answers FIX THE CONTRACT (exit 3) and Claude reruns; only real out-of-bounds reasons reach the owner. A committed contract, the project's caps file and a migration file no longer count as added source. Each role sets a call cap (15, up to 30 with a reason) and the script computes its budget as 14,000 x calls + growth x calls squared / 2, with growth 3,000, or 6,000 for a role reading a file over 40 KB; this replaces the 400,000 and 600,000 standards. The brief carries "Call cap: N", the sweep guard refuses a brief without one from the contract, and a new call-cap hook counts real calls and refuses tools near the cap so the report still arrives. The 25% trip stays on the whole sweep, and first push and launch gate now have a real budget. A project whose settings lack the hook answers FIX THE CONTRACT until it is merged in by hand, since install skips a changed settings file; with no project settings the start notice says the cap has no hook. The minimum cap is 5. A model outside opus and sonnet asks the owner. Going lighter after a stop at the same HEAD asks the owner. A sweep cut short is marked with --outcome --cut-short, and the owner's yes on the next contract closes it unmeasured. Caps take the lower of the branch and its base. Outcomes keep each role's calls; a transcript from another repo is refused, a round starts at its clearing, and the summary leaves hand-typed outcomes out.

## 1.16.0 - 2026-11-03
- Sweep auto-approval measures and budgets honestly, and runs the owner's loop without asking. The outcome reads each reviewer's spend itself, in processed tokens from its own transcript (--outcome --agents <id,...>); --tokens is refused; only a finished reviewer transcript, started after the clearance and not logged before, counts, and anything else asks the owner. A reviewer that ran on another model than its role names pauses for the owner. An approval no reviewer started under is closed with --outcome --none-ran. A role's budget is its model's standard (opus 400,000, sonnet 600,000, from five measured sweeps), up to 2x with a budgetReason. A tier's cap counts only the roles beyond its floor (fix 1, feature 5, triage 0), so a security-sensitive fix with changed tests approves; a project's caps still only go down, and an older maxAgents still applies. Each sweep gets one focused re-sweep (resweepOf, fixed: one blast-radius role, one per fixed kind, one dimension role; never more roles than the sweep, on a HEAD that builds on it, and asks when the fixes add a dependency or new source). A second re-sweep, or one of a re-sweep, is refused without a pause; the re-sweep's outcome needs --carried <n> (left unfixed from either pass), and carried findings show at every sweep start until --closed-carries closes them. Every ask and pause writes <contract>.triage.md (what tripped, the numbers, the log lines with relative paths and no owner words, the fix options). A tier or modifier named after a built-in object key (constructor, __proto__) is unknown and asks. The 25% trip, the repeat and escape trips and the trial review are unchanged.

## 1.15.0 - 2026-11-02
- Install runs only from a release: the kit folder's HEAD must be exactly at tag v<VERSION>, with nothing changed, new or ignored in what install copies or reads (user/, project/, memory/, scripts/, VERSION, kit.config.json, the owner profile), or the install is refused (--dry-run too) and names why and the fix. --unreleased installs a branch build on purpose, for a throwaway test only; its record carries release: false, the git describe text and any uncommitted files, and status and session start show it (for a project or ~/.claude) as unreleased until it is reinstalled from a release, which removes the files only that build installed (a changed one is kept, named, and keeps the gap open). Install records gain release and describe (older records read as unknown, not unreleased). Status, session start and both full-stop messages now say to check out the newest release tag, not git pull, which moved a kit folder onto main and off every tag.

## 1.14.0 - 2026-11-01
- A delete guard asks the owner before any shell delete that reaches outside this session's own temp folder (<temp>/claude/<project key>/<session id>/) and the project, so a closeout can no longer remove other sessions' files by wildcard. It reads deletes hidden in wrappers, nested shells, inline node or python, .NET calls, find, git clean, robocopy and rsync, follows junctions and links, and asks on any target it cannot place (a variable, a brace expansion, a UNC or drive-relative path, .git). A hook that crashes or times out blocks the call (needs Claude Code 2.1.295 or later). Projects with a customized settings.json add the guard-delete hook entry by hand. Its proof runs in CI.

## 1.13.0 - 2026-10-31
- Outward acts may run under a standing grant the owner writes (adapter row A27, none by default; no grant is in force until the grant check ships) [trial]. Recall fixes state each rule outright where a session answers from it, and recall key 10 is corrected to the rule the kit has (the report recorded and summarized in the PR); strict recall is 9/10 (median of three blind-scored runs). The kit repo has CI: kit-tests (tests, scrub, build freshness, push guard proof, project map, link scan, branch and commit names, a branch secret scan, a recall score when rules change, the PR body audit) is required on main, which stays the default branch everywhere. The approved rule review loosens hand checks that scripts now cover, widens the sweep trial review to every 20 approvals after two clean reviews, and folds recovery-protocol and what-this-file-is-not into session-workflow. The Standard PR body's Review section now carries the sweep summary (commit covered, result per dimension, high and critical findings, deferred items, accepted risks): projects move their PR bodies to the new shape, as a body in the old shape fails the audit. Session start 45,284 B (cap 45,500).

## 1.12.1 - 2026-10-31
- Status reaches Current in a real project: a file changed only here carries the project's own values and is listed, not counted as a gap; only a file changed here and in the kit holds it back, until the hand merge is recorded with kit.mjs install project <folder> --merged <file>,<file>. Session start names only files that owe a merge.

## 1.12.0 - 2026-10-31
- One kit skill per job: ui-craft, ui-review, debugging, plan-feature and tdd, condensed from 64 overlapping third-party skills (each with a SOURCES file of what was kept and dropped), plus review angles for pre-pr-sweep and on-demand references for agent-team-build. Checks that were counted by hand are scripts: commit messages and branch names (commit-msg and pre-push hooks), tracking caps, an empty parking lot before a sweep, evidence on each done plan line, skill cases suggested from the repo. Rarely used plugins stay on standby and switch on per project; kit.mjs measure --real counts what really loads, with a cap in status and a flag on a large memory index. New rules: the craft floor (screen job, floor check, refuse list, scored review, audit before editing), the context budget, team questions, the project map (a checked data file drawn as a plain page, refreshed at closeout), fact-check before handing over, diagrams that explain, outside repos read but never installed, auto-fix by default and auto-merge on the owner's yes. A snapshot keeps the backup of a standby skill. Recall 9/10, level with 1.5.0.

## 1.11.0 - 2026-10-31
- The commit check runs in agent worktrees on their own staged files and prints a pass line; the hooks path is absolute (closes IR-2026-10-31-commit-check-cannot-see-a-worktree-s-staged-files). PR-body audits read past a leading host attribution block (closes IR-2026-10-31-pr-body-audit-fails-on-the-required-attribution-header). The first push gate gains 'Protect main': a settings file, one gh command with a read-back, adapter row A26, and an unprotected main flagged in status (closes IR-2026-10-31-no-branch-rule-on-main-after-a-new-repo-goes-public). Both full-stop messages name the kit folder and the exact install steps.

## 1.10.0 - 2026-10-31
- A missing kit is a full stop: install user wires a gate that refuses every prompt in a folder with no kit (opt out with .kit/no-kit), and a project refuses every prompt when the active Claude config folder has no kit. The kit honors CLAUDE_CONFIG_DIR and names the folder it read. A repo that owns its CLAUDE.md gets the kit as an overlay in CLAUDE.local.md, recorded as host-owned and never flagged (closes IR-2026-10-31-overlay-on-team-repo). The kit's own CLAUDE.md and CLAUDE.local.md never go public, even when the kit is tracked.

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
