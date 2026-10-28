<!-- Written by kit.mjs build from rules/reviews-and-findings.md, in the layout of the Claude Code memory docs (code.claude.com/docs/en/memory). In the kit, edit the source, not this file. In a project, fill the adapter slots here; install keeps your changes, and fold-back carries rule changes back to the kit. -->

# Reviews and Findings

## The Finding Pipeline (Sweep Finding -> Fix) {#finding-pipeline}

**A finding is a HYPOTHESIS, not a work order** (the gates below test it). Why: "read finding -> write fix" makes each fix break the next thing.

- **G1 Triage:** TRUE? (read the code, quote the line; the finding's own quote is not evidence) REACHABLE on an ordinary path? WHICH rule does it break (none = not a finding)?
- **G1a Evidence bar - reproduce it OR quote it.** "Only if it fails" confuses UNREAL with UNOBSERVABLE (memory hygiene has no symptom). Truth = (1) a red test someone watched fail (mandatory when the class is observable), or (2) the quoted line + the hard rule + **an in-repo precedent enforcing that rule on the same class** (none -> backlog, not blocker). Reachability sets severity, not truth. Sweeps produce candidates; **the controller adjudicates**.
- **G2 Diagnose:** the mechanism in one sentence; the violated invariant; `git blame` (ours, or shipped and exposed?). Output: **a named root + a search pattern.**
- **G3 Cluster + search** (BARRIER): group by root; search the WHOLE codebase for each class, shipped code included; fix shared findings at the root (often one token or helper). **Roots get fixed, not findings.**
- **G4 Method:** the CONFIRMED fix with precedent; what it does NOT fix; **which side-effects of the current code it MUST preserve** (watch "moved to a better seam, dropped a side effect"). A fix is new code, most of all when it changes shape: name the failure class it opens (sync -> async: stale writes, unhandled rejections; a lazy seam: not-ready windows, cached rejections) and mirror the codebase's invariant for that shape.
- **G5 Blast radius** (-> the owner's go): files, shipped vs new, public interfaces, other callers, the revert story; a shipped-code fix in a feature branch is scope creep until the owner says otherwise.
- **G6 Fix** - TDD, **one ROOT per commit.**

**Hard rules:** batch at G3 (triage and diagnose everything, then fix roots). **Two passes:** one large sweep, then ONE short re-sweep over the whole batch (never per fix - an undamped loop) of whether the fixes broke anything; a third only for a major re-sweep finding.

### Features First; Findings Ride Inside the PR {#features-first}

1. **A standalone fix PR only for harm:** data loss, a stuck user, a silent outage.
2. **Sweep findings are fixed in their PR**, not only the easy ones; defer only the extremely minor (info, cosmetic, rare path, no harm), each recorded; leftovers go to the next focused PR touching that code or a fix sweep - the owner decides.
3. **Then features;** roadmap fixes ride a feature PR that touches their code; folded-in findings go in the before / after table.
4. **A run's order:** the owner picks the feature FIRST (even when a handoff lists fixes ahead); leftovers and recorded carry-overs are built on its branch (unless large, risky, device-only or a design call); ONE large sweep after both, the short re-sweep, one PR. The Resume Point names the feature pick first.

**Value check:** tier remaining work by what a user would notice (high: someone hits it; medium: keyboard or screen-reader correctness; low: millisecond races, byte trims, test hygiene), say the tier at each checkpoint, and recommend stopping when reviews return ever smaller things, before the owner asks; the value lens ends the loop, not fatigue. Why: a sweep generates work faster than value.

## Milestone Project Sweep (Periodic Multi-Agent Audit) {#milestone-sweep}

A MECHANICAL GATE with a checkable done-condition, run under an approved Swarm Contract (as is the red-team). Why: a sweep without a clear trigger never happens.

**Triggers:** (1) **before any substantive PR to `main`** (new behaviour or surface, security / privacy / legal relevance, a sub-project; when unsure, swarm) - the Pre-PR Deep Sweep; trivial chore / docs / one-line PRs get a light pass or a stated exemption; (2) **mid-build** when an arc adds a runtime dependency or external data flow; (3) a **launch-gate sweep** of EVERY surface before any public major version.

**Done iff** a report exists at `<sweep folder>/YYYY-MM-DD-<milestone>.md` with date, milestone, branch / commit; each dimension PASS or with findings; every high / critical dispositioned (`FIXED <commit>` / `DEFERRED <where>` / `ACCEPTED <why>`); for the deep tier, "still aligned with the version goals? YES/NO + evidence". <!-- PROJECT ADAPTER A22 -->

**Six fixed dimensions:** (1) privacy / data boundary - runtime leaks, third-party calls; (2) supply chain + bundle - dependency risk, build scripts, budgets; (3) legal / content + licenses (A2), citation fidelity; (4) code security + pattern consistency; (5) gaps + scaling - untested paths, deferred-now-load-bearing items, scale assumptions, new-test value; (6) version goal alignment - scope creep, drift from locks, overbuilding (the verdict). Plus any milestone-specific one; read-only reviewers per dimension -> a report grouped by when to act.

### Pre-PR Deep Sweep {#pre-pr-deep-sweep}

Why: a solo builder reviewing their own diff sees what they meant, not what they wrote.
- **Adversarial vulnerability swarm:** >= 3 top-tier security agents with DISTINCT angles.
- **A Test Value agent** ruling keep / cut / repoint on every added or edited test (the use guarded, a break check where in doubt); retired when reviews stop finding fluff.
- **Every high / critical independently re-checked** - an input to the controller's adjudication. **Dimension 6 mandatory.** **Covers the branch HEAD** - an older report does not count; re-run or sweep the delta.
- **Anti-hallucination clause:** satisfied ONLY by the agents actually running THIS session AND the report existing with their findings, dispositions and verdict - never by the controller's read, a recalled sweep, or "it looks fine". No report -> no PR.

### Pre-Push Op-Test {#pre-push-op-test}

Before a major or user-facing PR is pushed, USE the product on the production build at the PR head, served locally:
- **The lead's walkthrough:** every spec flow at desktop and narrowest width, every theme and engine, console watched, screenshots to the owner (scripted where the pane cannot load it).
- **Break-it testers** (mid tier, default three, one angle each - e.g. input order / rapid taps / date edges; tabs / locks / reloads / offline; keyboard / screen reader / zoom / forced colors), throwaway scripts in their own scratch folders, read-only on the repo, each finding with a reproducing script.
- **A live checklist** the owner watches: ticked as items pass, notes from both sides, overall status; the last run archived before reseeding; a closing debrief; the owner may hand the rest of a walk to the lead.
- **Findings go through the Finding Pipeline before the push** ("push now, fix later" is the owner's call). Docs / chore / test-only / one-line PRs exempt (stated); small PRs may run the walkthrough only, on the owner's call.

Satisfied ONLY by the walk and testers running this session with results in the sweep report. Why: a green gate and two sweeps still miss what a minute of real use finds.

### Preview Test Before Merge {#preview-test}

A user-facing PR is used on the host's own build of the branch before merge, on the device the stakes call for (below): open the link yourself first; made-up details only; nothing sent (previews may hold live secrets: -> Security "Secrets"). Why: the production platform and a real device are what local tests cannot imitate. <!-- PROJECT ADAPTER A19/A20 -->

**Who tests the preview, by stakes.** Every user-facing PR: the lead checks the deployed preview in phone and desktop emulation (headers, security policy, workers, layout), shown as shots. The owner's real device only for: a new or often-used surface; touch, keyboard or installed-app behaviour; device-only paths (downloads, file imports, sharing); screen-reader checks. Why: emulation cannot prove a device's fonts, system UI, keyboard or storage, so the owner's time goes where only a hand can tell.

### Visible Tracking {#visible-tracking}

`_Master Roadmap.md` carries `- [ ] Milestone sweep recorded -> <report>` per sub-project; **no sub-project is COMPLETE until it is checked**; orientation step 7 checks both. Why: a gate nobody can see on the roadmap is a gate the next session skips.

## Parking Lot + Pre-PR Idea Triage {#parking-lot}

- **Capture** (zero friction): one line under `## Parking Lot` at the top of the active plan - `- <idea> - <where noticed> - hunch: now | next`. No decision, no action.
- **Triage** after all gates pass, BEFORE the deep sweep: **Now** (small, in spirit, cuts churn; growing scope needs the owner's lock) -> built and swept in this PR; **Next** -> one line + pointer in the Roadmap; **Drop** -> deleted with a one-line why.
- **Done** when the lot is **empty** before the sweep; non-empty = the gate was skipped.

**Pipeline:** `build -> all gates green -> Parking Lot triage -> Pre-PR Deep Sweep -> fixes + re-sweep -> gate -> Pre-Push Op-Test -> fixes + gate -> PR body + audit to the owner -> push + PR (owner) -> preview test -> merge (owner) -> Post-Merge Check -> release (owner's go)`. Why: a "now" idea is built and swept inside the same coherent PR; an IDEA is distinct from a FINDING (a defect).
