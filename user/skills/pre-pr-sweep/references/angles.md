# Review Angles

Candidate reviewer roles for a Swarm Contract (rule:swarm-contract), loaded at pre-pr-sweep step 2. Why: a
role with its own question finds what the others cannot; one without is a clone.

## How to use an angle

- **A candidate, not a quota.** The count comes from the change's risk regions (rule:swarm-contract,
  rule:sweep-tiers). Pick an angle only when the diff enters its region ("Skip when" says when it does not).
- **Each feeds a dimension** of rule:milestone-sweep; the report groups by dimension, never by angle.
- **Security is not an angle here.** The security swarm (rule:pre-pr-deep-sweep), the security-sensitive modifier
  (rule:sweep-tiers) and rule:mid-design-red-team own injection, auth, secrets, path traversal and data exposure.
  An angle meeting one names it for that role.
- **Every brief also carries:** (1) *spec silence is not permission* - where the plan is silent, judge by what a
  reasonable person using the code expects, graded by the effect on them; (2) a *Declined to judge* list - one
  line per behaviour seen and set aside, with why (empty = none); the lead rules on each (receiving-findings.md);
  (3) *plan deviations named as such*, and a flaw in the plan itself reported as a plan flaw; (4) *severity by real
  effect* - most findings are not critical; reachability sets severity (rule:finding-pipeline G1a).
- **A finding, every angle:** file:line, the quoted line, the rule or invariant broken, the failure in one
  sentence (who hits it, on what path), a fix sketch when not obvious - shaped for rule:finding-pipeline G1.

## Backend (code-level correctness)

- **Question:** for each operation the change adds, do its failure path and its resources stay correct inside
  the code - every error surfaced with context, every acquired thing released, every shared value safe?
- **Feeds:** dimensions 4 and 5.
- **Look at:**
  - *Errors:* no swallowed failure (empty catch, bare `except`, an ignored promise or `Result`); context survives
    each boundary (worker -> client, script -> exit code); thrown values stay static codes (rule:code-standards).
    So does a crash path hidden in a helper (`.unwrap()`, `!` non-null, an unchecked index).
  - *Edge inputs:* empty, missing, zero, overflow, off by one, duplicate, out of order.
  - *Resources:* each handle, lock, listener, timer, stream, child process or temp file - where made, where
    released, and on the error path too? Table: resource | made in | released in | on error?
  - *Concurrency:* two writers to one value; locks taken in different orders; a lock held across an `await`
    (Rust/Tokio: can deadlock); a stale write after an async gap.
  - *Serialization boundary:* both sides match - field names and casing, optional on both, enum tags.
- **Skip when:** nothing that runs changes (markup, copy, styles, docs).
- **Finding:** "`store.ts:88` - `catch {}` drops a quota error; the save reports success; the entry is lost."

## Structure (the shape of the system)

- **Question:** does the change make the system harder to understand or change even if each file is fine - which
  way do the dependency arrows point now, and what must move when one requirement changes?
- **Feeds:** dimensions 4 and 6.
- **Look at:**
  - *Direction:* general code never imports specific code; lower layers never import higher ones; UI reaches the
    platform only through the project's service layer. One crossing "just this once" is a finding.
  - *Cycles,* including the back door (A uses B's type, B uses A's constant).
  - *Coupling - the delete test:* delete a new file; how many others break? Unrelated features aware of each
    other, or sharing one mutable store field, are coupled.
  - *Cohesion:* code placed in an existing file for convenience; one file with two jobs; a module past the size
    targets in rule:code-standards growing further.
  - *Change propagation:* one likely requirement change - how many files move?
  - *Abstraction level:* an if/else where the project has a seam (rule:dual-horizon), or a new abstraction for
    one caller (rule:simplicity-lens).
  - *Shared modules* keep their contract or name every caller.
- **Skip when:** one file changes and no import, export or boundary moves.
- **Finding:** "`search/panel.svelte:12` imports the worker client; other panels use `lib/search-service`."

## Repo upkeep (does it belong here)

- **Question:** does the change follow the repo's existing conventions and leave the repo as tidy as it found
  it - nothing duplicated, nothing orphaned, no pattern of its own?
- **Feeds:** dimension 4.
- **Look at:** conventions from rule:project-adapter (A6/A7) and the neighbouring files, never assumed.
  - *Placement and names* match the neighbours.
  - *Reuse:* search for an existing helper, component or type first; a near-copy wants a variant of the
    original. Three similar lines still beat a premature abstraction.
  - *Leftovers:* replaced code, exports, types and index entries removed in the same PR (rule:code-standards).
  - *Suppressions:* no new `eslint-disable`, `@ts-ignore`, `# type: ignore` or `any` without a one-line reason;
    logging through the project's logger, not a stray `console.log` or `print`.
  - *Guidance:* a new top-level folder agents work in may need a short guidance file.
  - *One-off drift:* a "slightly better" pattern beside the old one, unless the plan migrates the old one.
- **Skip when:** never at the feature tier; at fix tier, when no file is added, moved or renamed.
- **Finding:** "`lib/dates/fmt.ts` duplicates `formatShortDate` at `lib/format.ts:40`."

## Developer experience (the people who run the tooling)

- **Question:** will the next person who runs, configures or debugs this - the owner, a contributor, CI - know
  what happened, why, and what to do, without reading the source?
- **Feeds:** dimension 5. App end users: rule:design-for-human-error.
- **Look at:** scripts, CLIs, build and gate output, config files, developer-facing errors.
  - *Errors* say what failed, where (file, step) and the next action ("run `<cmd>` to create it"); network,
    permission and missing-file failures read differently. The top level maps a static code to this text.
  - *Defaults* work with no config for the common case; each config field has a comment.
  - *Help:* a new command or flag has `--help` with one example.
  - *Output:* data on stdout, chatter on stderr (a `--json` mode where a script reads it); success is quiet;
    progress matches the wait (under 1 s: nothing; 1-5 s: a line or spinner; over 5 s: a count).
  - *Safety:* a destructive command has a dry run or confirm; a changed flag or config format ships a migration
    note.
  - *Headless:* runs in CI and in the owner's shell dialect (rule:anti-hallucination).
- **Skip when:** no script, command, config or developer-facing message changes.
- **Finding:** "`scripts/build-index.mjs:51` exits 1 silently when the corpus folder is missing."

## Production readiness (does it survive the real world)

- **Question:** what happens when this meets the real environment over time - a deploy, a crash midway, a slow
  or absent dependency, ten times the data, an upgrade from the last release, a rollback?
- **Feeds:** dimensions 5 and 2. When the "data the user keeps" modifier role runs (rule:sweep-tiers), it takes
  the data-integrity line and this angle drops it.
- **Look at:** trace one full path (input -> processing -> storage -> read back -> display); list every outside
  dependency (network, storage, worker, model, process); ask of each: slow? down? garbage?
  - *Environment parity:* localhost or fixed ports, dev-only paths or flags, undocumented env vars, dev-server
    behaviour the build lacks, an asset in the tree but not the bundle.
  - *Failure midway:* state after a crash or force-quit at each step is consistent; every network or IPC call
    has a timeout; every retry is bounded.
  - *Data integrity:* atomic writes (temp, then rename or swap); new data written before old is deleted; two
    tabs cannot clobber each other; new code reads the last release's data, and the last release survives the
    new data (the rollback story).
  - *Lifecycle:* processes and workers stopped on exit, restarted or reported on crash; sleep, wake, offline.
  - *Scale:* no unbounded loop, query or list over user data; nothing quadratic on a hot path; fixtures sized
    like real data.
  - *Diagnosis without telemetry:* can the owner learn what broke from what the user sees or chooses to export
    (an on-screen code, a local log)? No tracker or remote logging is added (rule:security-standards).
- **Skip when:** never for a user-facing change; cosmetic ones check only that the bundle has every asset.
- **Finding:** a failure-table row - scenario | what fails | user impact | recovery | handled?

## Tech debt (what the change leaves behind)

- **Question:** what does this change add to, or leave unpaid in, the cost of the next change - and is that debt
  named with a retirement trigger, or silent?
- **Feeds:** dimensions 6 and 5.
- **Look at:** code (duplication, magic numbers); architecture (a missing seam a planned mode needs); tests
  (untested path, flaky or mock-only - rule:test-value); dependencies (outdated, unmaintained); docs (stale,
  no runbook); infra (manual deploy step, no post-deploy check).
  - A shortcut taken on purpose is accepted debt with a retirement trigger (rule:dual-horizon); a silent one is
    the finding. So is an earlier deferred item this change now builds on.
- **Order recorded debt** by `(impact + risk) x (6 - effort)`, each 1-5 (impact: slows the next change; risk:
  cost if left; effort: lower is cheaper). Debt in this PR's own diff is not ordered; rule:features-first holds.
- **Skip when:** triage tier, unless the change defers something on purpose.
- **Finding:** "`search/retrieve.ts:20` hard-codes server mode; the planned on-device mode needs a seam.
  Unrecorded. (3+3)x(6-2) = 24."
