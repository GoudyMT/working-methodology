<!-- Written by kit.mjs build from rules/reviews-and-findings.md (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Reviews and Findings

## The Finding Pipeline (Sweep Finding -> Fix) {#finding-pipeline}

**A finding is a HYPOTHESIS, not a work order** (the gates below test it). Why: "read finding -> write fix" makes each fix break the next thing.

- **G1 Triage:** TRUE? (read the code, quote the line; the finding's own quote is not evidence) REACHABLE on an ordinary path? WHICH rule does it break (none = not a finding)?
- **G1a Evidence bar - reproduce it OR quote it.** "Only if it fails" confuses UNREAL with UNOBSERVABLE (memory hygiene has no symptom). Truth = (1) a red test someone watched fail (mandatory when the class is observable), or (2) the quoted line + the hard rule + **an in-repo precedent enforcing that rule on the same class** (none -> backlog, not blocker). Reachability sets severity, not truth. Sweeps produce candidates; **the controller adjudicates**.
- **G2 Diagnose:** the mechanism in one sentence; the violated invariant; `git blame` (ours, or shipped and exposed?). Output: **a named root + a search pattern.**
- **G3 Cluster + search** (BARRIER): group by root; search the WHOLE codebase for each class, shipped code included; fix shared findings at the root (often one token or helper). **Roots get fixed, not findings.**
- **G4 Method:** the CONFIRMED fix with precedent; what it does NOT fix; **which side-effects of the current code it MUST preserve** (watch "moved to a better seam, dropped a side effect"). A fix is new code, most of all when it changes shape: name the failure class it opens (sync -> async: stale writes, unhandled rejections; a lazy seam: not-ready windows, cached rejections) and mirror the codebase's invariant for that shape.
- **G5 Blast radius:** files, shipped vs new, public interfaces, other callers, the revert story, in the report; the owner's go only for shipped code outside the branch's scope or a public interface.
- **G6 Fix** - TDD, **one ROOT per commit.**

**Hard rules:** batch at G3 (triage and diagnose everything, then fix roots). **Two passes:** one large sweep, then ONE short re-sweep over the whole batch (by tier: rule:sweep-tiers; never per fix - an undamped loop) of whether the fixes broke anything; a third only for a major re-sweep finding. A finding carries to the next run only at medium or below: a high or critical is fixed before the PR (found after it: on the open PR), or the owner accepts it.

### Features First; Findings Ride Inside the PR {#features-first}

1. **A standalone fix PR only for harm:** data loss, a stuck user, a silent outage.
2. **Sweep findings are fixed in their PR**, not only the easy ones; defer only the trivial (info, cosmetic, rare path, no harm), each recorded. Leftovers and post-PR findings at medium or below go to the handoff's carry-overs for the next focus build.
3. **Then features;** roadmap fixes ride a feature PR that touches their code; folded-in findings go in the before / after table.
4. **A run's order:** the feature comes FIRST (a fix first only when high or critical): the confirmed work order's next, else the owner's pick; leftovers and recorded carry-overs ride on its branch (unless large, risky, device-only or a design call); ONE large sweep after both, the short re-sweep, one PR. The Resume Point names the feature pick first.

**Value check:** tier remaining work by what a user would notice (high: someone hits it; medium: keyboard or screen-reader correctness; low: millisecond races, byte trims, test hygiene), say the tier at each checkpoint, and recommend stopping when reviews return ever smaller things, before the owner asks; the value lens ends the loop, not fatigue. Why: a sweep generates work faster than value.

## Milestone Project Sweep (Periodic Multi-Agent Audit) {#milestone-sweep}

A MECHANICAL GATE with a checkable done-condition, run under an approved Swarm Contract. Why: a sweep without a clear trigger never happens.

**Triggers:** (1) **before any substantive PR to `main`** (new behaviour or surface, security / privacy / legal relevance, a sub-project; when unsure, swarm) - a sweep at its tier (rule:sweep-tiers), the Pre-PR Deep Sweep for a feature; a chore / docs / one-line PR gets the triage tier; (2) **mid-build** when an arc adds a runtime dependency or external data flow; (3) a **launch-gate sweep** of EVERY surface before any public major version.

**Done iff** a report exists at `<sweep folder>/YYYY-MM-DD-<milestone>.md` with date, milestone, branch / commit; each dimension PASS or with findings; every high / critical `FIXED <commit>` or `ACCEPTED owner <why>`; for the deep tier, "still aligned with the version goals? YES/NO + evidence". <!-- PROJECT ADAPTER A22 -->

**Six fixed dimensions:** (1) privacy / data boundary - runtime leaks, third-party calls; (2) supply chain + bundle - dependency risk, build scripts, budgets; (3) legal / content + licenses (A2), citation fidelity; (4) code security + pattern consistency; (5) gaps + scaling - untested paths, deferred-now-load-bearing items, scale assumptions, new-test value; (6) version goal alignment - scope creep, drift from locks, overbuilding (the verdict). Plus any milestone-specific one; read-only reviewers per dimension -> a report grouped by when to act.

### Sweep Tiers {#sweep-tiers}

Every sweep has a tier, set at plan approval (the lead proposes, the owner may change it) and named on the report's first lines as `- **Tier:** <tier>`. When unsure, the higher tier. Why: one size is too heavy for a typo and too light for a new surface; a named tier is one the owner can correct.

| Tier | When | Agents | Must cover | Report |
|---|---|---|---|---|
| **Feature** | a new feature, an expansion, a sub-project, a new surface or behaviour | a Swarm Contract (rule:swarm-contract): the Pre-PR Deep Sweep's roles below, more by risk region | all six dimensions; every high / critical re-checked; the alignment verdict | the full report |
| **Fix** | a fix or change to existing behaviour in a known area (one component, one flow) | 2-3: one on the fix (its root, and whether it holds), one on its blast radius (callers, the code it was modelled on), plus Test Value when tests change | each dimension PASS, its findings, or "not touched" and why; the alignment verdict | a short report |
| **Triage** | a chore, docs, config, a bump with no new package, a one-line change, a batch of small recorded fixes | 1, fast and read-only, with a call cap in its brief | the diff's secrets and personal-data check; each dimension "not touched" or its finding | a few lines, in the sweep folder or the PR body's gates |
| **First push** | the first push to a new remote, once | the deep sweep's roles plus a history role: every commit, not just the diff | all six dimensions; rule:first-push-gate passes; the owner reviews what is tracked | the full report |
| **Launch gate** | before any public major version (trigger 3) | per surface, under a Swarm Contract | every surface, all six dimensions, the alignment verdict | the full report |

**Modifiers add roles at any tier, and never lower one:** security-sensitive code (auth, locks, crypto, permissions, secrets, personal data) gets the security swarm of >= 3 distinct angles; a new dependency or external data flow gets a supply-chain role and a privacy role (trigger 2); public, legal or cited text gets a content role that checks each claim against its source and license; data the user keeps (storage formats, migrations, deletion) gets a role on data loss and the upgrade path from the last release.

**Re-sweep by tier:** feature, first push and launch gate run the one short re-sweep (rule:finding-pipeline); a fix tier's fix check covers it; triage runs none unless it found something. A stated exemption is left only for a PR that changes no code and no public text. **How: the pre-pr-sweep skill.**

### Sweep Auto-Approval {#sweep-auto-approval}

A feature, fix or triage sweep's Swarm Contract is approved by `~/.claude/skills/pre-pr-sweep/approve.mjs` (`$HOME` in PowerShell; or your Claude config folder), never an agent: same contract, same answer. If not there, the kit's user layer is not installed: say so, and the owner approves. It runs first; only an ASK goes to the owner (yes logged, `--owner-yes`); hooks hold reviewers until the log clears HEAD and contract, then at their caps. It approves when the tier's and modifiers' roles are there, each with its own question, context, finding shape and call cap (its budget), within the tier's caps; else FIX THE CONTRACT (Claude's slip) or the owner decides, told why. First push and launch gate always ask. It logs decisions and outcomes, pausing after tokens 25% over budget, a third of findings repeated, a bug escaping a passed sweep, or every 10 approvals (the trial review; 20 after two clean in a row), and only the owner resumes it; a cap overrun is named at the outcome. Why: a routine sweep need not wait.

### Pre-PR Deep Sweep {#pre-pr-deep-sweep}

Why: a solo builder reviewing their own diff sees what they meant, not what they wrote.
**How: the pre-pr-sweep skill.**
The roles below are the feature and launch-gate floor; fix and triage run rule:sweep-tiers' roles.
- **Adversarial vulnerability swarm:** >= 3 top-tier security agents with DISTINCT angles.
- **A Test Value agent** ruling keep / cut / repoint on every added or edited test (the use guarded, a break check where in doubt); retired when reviews stop finding fluff.
- **Every high / critical independently re-checked** - an input to the controller's adjudication. **Dimension 6 mandatory.** **Covers the branch HEAD** - an older report does not count; re-run or sweep the delta.
- **Anti-hallucination clause:** satisfied ONLY by the agents actually running THIS session AND the report existing with their findings, dispositions and verdict - never by the controller's read, a recalled sweep, or "it looks fine". No report -> no PR.

### Pre-Push Op-Test {#pre-push-op-test}

Before a major or user-facing PR is pushed, USE the product on the production build at the PR head, served locally:
- **The lead's walkthrough:** every spec flow at desktop and narrowest width, every theme and engine, console watched, screenshots to the owner (scripted where the pane cannot load it).
- **Break-it testers** (mid tier, default three, one angle each - e.g. input order / rapid taps; tabs / reloads / offline; keyboard / screen reader / zoom), throwaway scripts in scratch folders, read-only on the repo, each finding with its reproducing script.
- **A live checklist** the owner watches: ticked as items pass, notes from both sides, overall status; the last run archived first; a closing debrief; the owner may hand the rest of a walk to the lead.
- **Findings go through the Finding Pipeline before the push** ("push now, fix later" is the owner's call). Docs / chore / test-only / one-line PRs exempt (stated); small PRs may run the walkthrough only, on the owner's call.

Satisfied ONLY by the walk and testers running this session with results in the sweep report. Why: a green gate and two sweeps still miss what a minute of real use finds.

### Preview Test Before Merge {#preview-test}

A user-facing PR is used on the host's own build of the branch before merge, on the device the stakes call for (below): open the link yourself first; made-up details only; nothing sent (previews may hold live secrets: -> Security "Secrets"). Why: local tests cannot imitate the production platform and a real device. <!-- PROJECT ADAPTER A19/A20 -->

**How: the preview-test skill.**

**Who tests the preview, by stakes.** Every user-facing PR: the lead checks the deployed preview in phone and desktop emulation (headers, security policy, workers, layout), shown as shots. The owner's real device only for: a new or often-used surface; touch, keyboard or installed-app behaviour; device-only paths (downloads, file imports, sharing); screen-reader checks. Why: emulation cannot prove a device's fonts, system UI, keyboard or storage, so the owner's time goes where only a hand can tell.

### Visible Tracking {#visible-tracking}

`_Master Roadmap.md` carries `- [ ] Milestone sweep recorded -> <report>` per sub-project; **no sub-project is COMPLETE until it is checked**; orientation step 7 checks both. Why: a gate nobody sees on the roadmap gets skipped.

## Parking Lot + Pre-PR Idea Triage {#parking-lot}

- **Capture:** one line under `## Parking Lot` at the top of the active plan - `- <idea> - <where noticed> - hunch: now | next`. No decision, no action.
- **Triage** after all gates pass, BEFORE the deep sweep: **Now** (small, in spirit, cuts churn; growing scope needs the owner's lock) -> built and swept in this PR; **Next** -> one line + pointer in the Roadmap; **Drop** -> deleted with a one-line why.
- **Done** when the lot is **empty** before the sweep; non-empty = the gate was skipped.

**Pipeline:** `build -> all gates green -> Parking Lot triage -> Pre-PR Deep Sweep -> fixes + re-sweep -> gate -> Pre-Push Op-Test -> fixes + gate -> PR body (carrying the sweep summary) + audit to the owner -> push + PR (owner) -> preview test -> merge (owner) -> Post-Merge Check -> release (owner's go)`. Why: a "now" idea is built and swept inside the same PR.
