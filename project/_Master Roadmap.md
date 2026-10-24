# Master Roadmap - <PROJECT NAME>

> **Unique job: task status across all versions - checkboxes ONLY.** Depth lives in the design spec, the ADRs and the per-version plans; narrative + commit hashes live in [`_Session Log.md`](_Session Log.md). A description in this file is drift - it disguises stale checkboxes as current work. Per-version entry <= 80 words / 4 lines.

**Status Legend:** `- [ ]` = not started | `- [/]` = in progress | `- [x]` = complete | `- [!]` = blocked | `- [~]` = deferred

**Full Vision Source:** `<path to master design spec>`

---

## v<X.Y> - "<version name>" (<STATUS>)

> <One-line scope + spec / plan link.>

**Last verified against the codebase: <YYYY-MM-DD>.** A box no audit has verified is a claim, not a status. Re-verify at each Pre-PR Deep Sweep and at the launch gate.

**Two kinds of item follow; never mix them.** *Sub-projects* are per-session build work - the session doing the work checks the box. *Launch-gate criteria* are acceptance checks verified at the gate by an audit pass; they are not tasks.

### Sub-projects

#### <Sub-project name> - <STATUS>

Spec <link> | plan <link>

- [ ] <task>
- [ ] Milestone sweep recorded -> `<sweep report path>`

### v<X.Y> Launch Gate

> **Acceptance criteria, NOT per-session tasks.** Each is satisfied by the codebase or it is not; the comprehensive launch-gate sweep closes them.

#### Privacy + Security

- [ ] <criterion>

#### Accessibility

- [ ] <criterion>

#### Testing

- [ ] <criterion>

#### CI/CD + Hosting

- [ ] <criterion>

#### Launch Readiness

- [ ] <criterion>

---

## v<X.Y+1> - "<version name>" (<STATUS>)

- [ ] <item>

---

## Long-Term Backlog (Not Committed to Any Version)

- [ ] <item>

---

## Cross-Cutting Concerns (Apply Every Version)

- <pointer to the standard that governs it>
