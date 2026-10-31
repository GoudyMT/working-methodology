# Rule review (2026-10-31)

This is a review of every rule in the kit: the 14 Hard Rules in project/CLAUDE.md, the six non-negotiables in rules/_parts/agents-head.md, and every rule heading with an ID in rules/*.md. Each rule was checked for what enforces it (a hook, script or test, found by grep for its ID or key phrase) and what shows it still matters (improvement reports, the recall test, Loop Learnings, CHANGELOG, TRIALS). A stance of Loosen is given only where a script already checks the thing and the rule is not Tier 0; Merge only where two rules say the same thing; Retire only where nothing references or enforces the rule. Nothing changes until the owner decides each stance.

**Counts:** 100 rules reviewed. Keep 94 / Loosen 4 / Merge 2 / Retire 0.

Notes on the columns:
- **Load:** "always" = in CLAUDE.md or AGENTS.md at session start; "on demand" = an on-demand module; "on demand (file)" = a `load: files` module, read before the named work and auto-loaded when a matching file opens.
- **Tests** are named by line in tests/kit.test.mjs ("t.2856" = the test at line 2856).
- **Recall Q** = a question in docs/evals/recall-questions.md; scores in docs/evals/results/recall-scores.md.
- **IR-** = a report in reports/improvements/.

## Hard Rules (project/CLAUDE.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| HR1 | always | Plan mode by default; the owner locks A/B/C; records-answered calls are delegated | text only | Recall Q1 (passes 1.13.0) | Keep |
| HR2 | always | One issue at a time; bulk instructions do not override locks | text only | Recall Q1 | Keep |
| HR3 | always | Privacy and security above all | partly: .githooks/pre-commit -> first-push-check.mjs --staged blocks secret-shaped files/values | t.1597; Loop Learnings Graduated (dev-server walk -> rule:security-standards) | Keep (Tier 0) |
| HR4 | always | Domain hard boundaries (adapter A2) | text only (adapter slot) | none found (per-project fill-in) | Keep (Tier 0) |
| HR5 | always | Content and data sourcing rules (A2) | text only (adapter slot) | none found (per-project fill-in) | Keep (Tier 0) |
| HR6 | always | Named security baseline (A3) | text only (adapter slot) | none found (per-project fill-in) | Keep (Tier 0) |
| HR7 | always | TDD: tests first, watch each fail | text only (tdd skill) | Loop Learnings Graduated #2 (a test must be able to fail) | Keep |
| HR8 | always | Edit Discipline's four visible steps gate every code write | text only | none found beyond the rule itself | Keep |
| HR9 | always | Tracking files are pointers, one unique job each | text only (hand anti-duplication scan) | none found | Keep |
| HR10 | always | Tracking files update at milestones, not every step | text only | none found | Keep |
| HR11 | always | After a compact: fresh reads of the handoff's Reading Order first | project/.claude/kit-hook.cjs names the rule at compact start | t.1074; Recall Q3 (fails 1 of 3 at 1.13.0 rerun); commit ffa811d | Keep |
| HR12 | always | Tests never yield to the implementation; test value | text only | Recall Q2 (passes) | Keep |
| HR13 | always | Pre-PR Deep Sweep that really ran, report recorded and summarized in the PR | user/skills/pre-pr-sweep/audit.mjs, approve.mjs; user/kit-hooks/sweep-guard.cjs; pr-body-audit.mjs Review section | t.2358; Recall Q10 (fails 2 of 3 at 1.13.0 rerun) | Keep |
| HR14 | always | Outward acts are the owner's unless a standing grant covers them | .githooks/pre-push; project/.claude/guard-outward.cjs | t.2856 (owner's exact text), t.1196; Recall Q4; IR-2026-10-31-no-branch-rule-on-main | Keep |

## Non-negotiables (rules/_parts/agents-head.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| NN1 | always | One issue at a time, locked by the owner | text only | Recall Q1 | Keep |
| NN2 | always | Code writes gated by Edit Discipline | text only | none found | Keep |
| NN3 | always | New chat: read the Read Order, resume at the first open issue | kit-hook.cjs names the orientation rule after a compact | t.1074; Recall Q3 | Keep |
| NN4 | always | Privacy and security above all | partly: pre-commit secret block | t.1597 | Keep (Tier 0) |
| NN5 | always | Tests never yield to the implementation | text only | Recall Q2 | Keep |
| NN6 | always | Outward acts are the owner's unless granted | .githooks/pre-push; guard-outward.cjs | t.2856; Recall Q4 | Keep |

## core (rules/core.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| critical-rules-priority-index | always | Tiers 0-4 decide which rule wins a conflict | text only (exempt from the why test, t.551) | "Tier 0" cited in rule:standing-grants, docs/plans/kit-autopilot.md | Keep |
| instruction-priority | always | Owner chat > global CLAUDE.md > standards > tool defaults | text only | none found | Keep |
| owners-rules | always | Honest, never guess, shipped precedent, plain words | text only | none found (cited by plan-feature, pre-pr-sweep skills) | Keep (#6 is Tier 0) |
| collaborative-design-locks | always | The owner locks each decision; A/B/C shape | text only | Recall Q1 | Keep |
| goal-before-mechanism | always | Explore the goal, not the named knob | text only | none found (plan-feature skill) | Keep |
| delegated-decisions | always | Decide what records answer; impact test; `Decided alone` | text only | none found (HR1, plan-feature skill) | Keep |
| edit-discipline | always | Four visible steps before any Edit/Write | text only (builder edit-fence is agents only) | none found | Keep |
| outward-acts | always | Push, PR, merge, release, tag are the owner's; auto-fix scope | .githooks/pre-push; guard-outward.cjs (+ guard-outward-check.cjs) | t.1196, t.908, t.2856; Recall Q4; IR-2026-10-31-no-branch-rule-on-main | Keep (loosen path is rule:standing-grants once autonomy.mjs exists) |
| session-workflow | always | Start reads, plan the whole cycle, end batch, compact after big tasks | text only | none found | Keep |
| context-engineering | always | Four context failure modes; curate tool loadout | text only | none found | Keep |
| anti-hallucination | always | Verify, label guess vs proven, compute or quote | text only | Loop Learnings Graduated (2 lessons); IR-2026-10-30-pr-body-audit-holds-checks | Keep |
| correction-loop | always | Capture an owner correction as a rule the same session | text only | none found | Keep |
| autonomous-fixes | always | Fix the obvious and report; ask on the ambiguous | text only | none found | Keep |
| direction-changes | always | A changed direction states why, how, reference | text only | none found (Priority Index 5b) | Keep |
| re-plan-on-failure | always | Stop and flag when a lock proves wrong | text only | none found | Keep |
| simplicity-lens | always | Ask for the simpler version with the same outcome | text only | none found | Keep |
| dual-horizon | always | Judge now-fit and end-state fit; temporary-fix gate | user/skills/adr/audit.mjs checks the Dual-Horizon block | t.884 | Keep |
| success-charter | always | Write the charter before high-uncertainty work | text only | none found | Keep |
| recovery-protocol | always | On context loss, read the start files in order, resume at first open issue | text only | none found (cited by collaborative-design-locks #3, _Start Here.md) | Merge (with session-workflow "Start"; NN3 says the same) |
| what-this-file-is-not | always | Scope note: not spec, roadmap or history; read AGENTS.md first | text only (exempt in t.551) | none found | Merge (with session-workflow; its read order repeats it) |

## agent-teams (rules/agent-teams.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| multi-agent-discipline | on demand | A mode signal sets the kind of work, never its size | text only | Recall Q7 (via the swarm contract) | Keep |
| swarm-contract | on demand | No swarm without an approved contract table | user/skills/pre-pr-sweep/approve.mjs; user/kit-hooks/sweep-guard.cjs | t.1827-2019; Recall Q7; IR 2026-10-30-sweep-approval-miss | Keep |
| patterns-and-dispatch | on demand | Which agent patterns are OK; model tiers; direct by default | text only | none found (agent-team-build, plan-feature skills) | Keep |
| agent-role-table | on demand | Each role's tools and preloaded rules | user/kit-hooks/edit-fence.cjs, clean-tree.cjs; scripts/kit.mjs build | t.1128, t.1139, t.1161-1274 | Keep |
| agent-canary | on demand | Agents open each message with the phrase; a miss voids the run | user/kit-hooks/canary.cjs; canary-phrase.mjs; PR and release audits | t.1301-1442, t.1774, t.2105, t.2122; CHANGELOG 1.5.0, 1.6.1 | Keep |
| agent-team-adapter | on demand | Per-project batch fields, incl. the rules block every brief reads | canary.cjs reads field 8; kit.mjs | t.482, t.1360, t.1432 | Keep |

## code (rules/code.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| code-standards | on demand (file) | Size targets, WHY comments, ASCII, opaque error codes | text only | Loop Learnings Graduated #3, #5 (escapes, opaque codes) | Keep |
| size-budgets | on demand (file) | Trim and measure before asking for room; one band per plan | project/.claude/size-band.mjs | t.2065-2090; Recall Q8; CHANGELOG 1.6.0 | Keep |

## design-and-ux (rules/design-and-ux.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| visual-design-collaboration | on demand (file) | The owner locks visuals from a wireframe in the real screens | text only | Recall Q5 (passes) | Keep |
| craft-floor | on demand (file) | Floor checks, refusal list, scored review for any screen | text only (ui-craft, ui-review skills; no audit script) | TRIALS: promoted 1.12.0 | Keep |
| design-for-human-error | on demand (file) | Exact-entry fields show errors; lightest hurdle that covers the threat | text only (human-factor skill) | none found (Component Spec Template cites it) | Keep |
| diagrams | on demand (file) | One claim per figure; draw the mechanism; project map | project/.claude/project-map.mjs | t.2665-2693; CHANGELOG 1.12.0; TRIALS 1.12.0 | Keep |

## evidence-and-failures (rules/evidence-and-failures.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| failure-response | on demand | Stale kit first, then triage, dump data, verify before push | text only | CHANGELOG 1.7.1 (step 0 added) | Keep |
| enumerate-before-you-count | on demand | Read every match before trusting a count | text only | Loop Learnings Graduated (capped search is not absence) | Keep |
| instruments-and-evals | on demand | A surprising number is a claim about the instrument; run a control | text only | recall-scores.md (control run, blind scorers, key 10 correction) | Keep |
| probe-scope | on demand | Mark each probe row MATCHED, GATED or CANARY | text only | none found | Keep |
| snag-response | on demand | Least-invasive path, one recommendation, document the snag | text only | none found (debugging skill) | Keep |
| fact-check | on demand | Check and label every claim before handing work over | text only | CHANGELOG 1.12.0; TRIALS 1.12.0 | Keep |

## git-and-release (rules/git-and-release.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| pre-commit | on demand (file) | Every commit through the hook; never --no-verify; never chain after a failure | .githooks/pre-commit -> first-push-check.mjs --staged | t.1597, t.2568; Loop Learnings Graduated (no chained commit); IR-2026-10-31-commit-check | Keep |
| commit-message-format | on demand (file) | One line `type: subject`, no body or trailer | .githooks/commit-msg -> project/.claude/name-check.mjs message | t.2707, t.2729 | Loosen: drop the hand "git log -20" check and the loop's "show one sample message first" (rule:outward-acts); the hook's verdict is the check |
| branching | on demand (file) | Branch first; plain `<type>/<name>`; retire merged branches | .githooks/pre-push -> name-check.mjs branch | t.2723, t.2729; IR-2026-10-31-no-branch-rule-on-main | Loosen: drop "read recent PR branch names first"; name-check.mjs refuses a bad name at push. Branch-first stays |
| pr-body | on demand (file) | Standard or Lean format, audited, shown to the owner before any push | project/.claude/pr-body-audit.mjs, pr-body-audit-lean.mjs, version-bump-check.mjs | t.894-950, t.2297-2374, t.2588; IR-2026-10-30 and IR-2026-10-31 (pr-body audits); CHANGELOG 1.9.0, 1.11.0 | Keep |
| release-notes | on demand (file) | Release after a user-facing merge; audited; the owner publishes | user/skills/release-notes/audit.mjs; version-bump-check.mjs | t.816, t.943, t.1442 | Keep (public posts never granted) |
| post-merge-check | on demand (file) | Verify the deploy landed and the critical path answers | text only | none found (release-notes skill cites it) | Keep |
| kit-stays-local | on demand (file) | Kit and private notes never reach the repo | .githooks/pre-commit; first-push-check.mjs; kit.mjs install | t.1487-1500, t.1702, t.2495, t.2568; IR-2026-10-31-commit-check, IR-2026-10-31-overlay | Keep (privacy) |
| first-push-gate | on demand (file) | Strictest whole-history check before the first push; protect main | first-push-check.mjs; .githooks/pre-push | t.1522-1766, t.2609; IR-2026-10-31-no-branch-rule-on-main | Keep (privacy) |
| standing-grants | on demand (file) | Owner-written grant lets named outward acts run, checked and logged | none yet: autonomy.mjs not in the kit; t.2856 checks the text only | TRIALS (open, 1.13.0); docs/plans/kit-autopilot.md | Keep |

## kit-standards (rules/kit-standards.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| kit-standards | on demand | 15 rules for how the kit stays current, small and enforced | kit-hook.cjs; user/kit-hooks/kit-gate.cjs; improvement-report.mjs; kit.mjs | t.482, t.539, t.551, t.565, t.2143-2191, t.2526-2553; Loop Learnings scoreboard | Keep |

## loop-mode (rules/loop-mode.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| loop-workflow-mode | on demand | Keyword-armed TDD loop; scoping; visual checkpoint | text only | Loop Learnings Graduated (scope loop-worthiness first) | Keep |
| graduated-loop-lessons | on demand | Eight standing lessons; a repeat is a regression | text only | Loop Learnings Graduated list (#1-#8) | Keep |

## project-adapter (rules/project-adapter.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| project-adapter | on demand | Per-project values A1-A27 | partly: t.2856 checks row A27 | t.2856; Loop Learnings Graduated (#6 -> A23) | Keep |

## reviews-and-findings (rules/reviews-and-findings.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| finding-pipeline | on demand | A finding is a hypothesis: triage, diagnose, cluster, fix roots | text only | Recall Q6 (passes at rerun) | Keep |
| features-first | on demand | Findings ride inside the feature PR; the owner picks the feature first | text only | none found (Active Plan template "Order of a run") | Keep |
| milestone-sweep | on demand | Sweep triggers, six dimensions, "done iff" report | user/skills/pre-pr-sweep/audit.mjs | t.829, t.933 | Keep |
| sweep-tiers | on demand | Feature / fix / triage / first push / launch gate tiers | audit.mjs, approve.mjs | t.839; IR-2026-10-31-overlay-on-team-repo | Keep |
| sweep-auto-approval | on demand | approve.mjs approves in-rule contracts; pauses on drift | approve.mjs; user/kit-hooks/sweep-guard.cjs | t.1827-2019, t.2204-2263, t.2387-2415; IR 2026-10-30-sweep-approval-miss | Loosen: the every-10-approvals owner review (TRIAL_EVERY) could widen to every 20 after two clean reviews; the other pause trips stay |
| pre-pr-deep-sweep | on demand | Feature floor: 3+ security angles, Test Value agent, report at HEAD | approve.mjs (role floor); audit.mjs | t.1799 fixture; Recall Q10 | Keep |
| pre-push-op-test | on demand | Use the product at the PR head; break-it testers | text only | none found | Keep |
| preview-test | on demand | Test the host's preview before merge, by stakes | user/skills/preview-test/audit.mjs | t.866, t.957 | Keep |
| visible-tracking | on demand | Roadmap box per sub-project for its sweep | text only (orientation step 7) | none found (_Master Roadmap.md template) | Keep |
| parking-lot | on demand | Capture ideas in one line; triage before the sweep | project/.claude/tracking-check.mjs parking | t.2804; Recall Q9 | Keep |

## security (rules/security.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| security-standards | on demand | Baseline, secrets, outside repos read never installed, SAST | partly: pre-commit secret block | t.1597; Loop Learnings Graduated (dev-server walk); TRIALS 1.12.0 | Keep (Tier 0) |
| mid-design-red-team | on demand | Red-team designs touching data, crypto, auth before lock | text only | none found | Keep (Tier 0) |

## testing (rules/testing.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| tdd | on demand (file) | Red, green, refactor for every feature and fix | text only (tdd skill) | TRIALS 1.12.0 (tdd skill); Loop Learnings Graduated #2 | Keep |
| ci-gate | on demand (file) | Green = every step of every CI workflow, run in full | text only | none found | Keep |
| test-and-review-cadence | on demand (file) | How often checks run; load guard; mid-model reviewer trial | project/.claude/load-guard.cjs; approve.mjs model rule | t.628-650, t.2263; TRIALS (mid-model, open) | Keep |
| sub-agent-verification | on demand (file) | A fresh agent hunts overfitting after GREEN | text only | none found in the kit (a project carries it: fold-back 2026-10-30) | Keep |
| test-integrity | on demand (file) | Never weaken a test; dump output before deciding | text only | Recall Q2 | Keep |
| test-value | on demand (file) | Every test guards a real use; proof by break | approve.mjs (Test Value role when tests change) | Loop Learnings Graduated (surviving mutation) | Keep |
| sdd-triangle | on demand (file) | Spec, tests, code stay in sync; ADRs; drift markers | user/skills/adr/audit.mjs | t.884, t.920 | Keep |

## tracking-and-handoff (rules/tracking-and-handoff.md)

| ID | Load | Gist | Enforcement | Evidence it still matters | Stance |
|---|---|---|---|---|---|
| tracking-file-size-caps | on demand (file) | Word and line caps; over a cap, move to archive | tracking-check.mjs caps (whole-file rows) | t.2788 | Keep |
| session-log-compression | on demand (file) | Two full sessions, older compressed, moved not deleted | partly: tracking-check.mjs caps (10 sessions) | none found (Session Log template) | Keep |
| tracking-file-functions | on demand (file) | One job per tracking file; plan Progress needs evidence | tracking-check.mjs progress | t.2804 | Keep |
| status-files-rot-silently | on demand (file) | Split tasks from criteria; stamp last verified | text only | none found (_Master Roadmap.md template) | Keep |
| tracking-file-batching | on demand (file) | Update tracking files at milestones only | text only | none found (closeout skill) | Keep |
| decision-documents | on demand (file) | Optional public doc on why tools were chosen | text only | none found in the kit (a project carries it: fold-back 2026-10-30) | Keep |
| compact-ritual | on demand (file) | "begin pre-compact" runs the closeout steps | text only (closeout skill) | none found | Keep |
| pre-compact-scan | on demand (file) | ASCII, labels, duplication, caps, temp files, rule sort | user/skills/closeout/audit.mjs; tracking-check.mjs caps; kit-hook.cjs pre-compact | t.875, t.384 | Loosen: step 3's hand-counted table for the whole-file rows -> the `tracking-check.mjs caps` output; capped lines still counted by hand |
| post-compact-orientation | on demand (file) | Fresh reads plus a visible checklist after a compact | kit-hook.cjs; scripts/kit.mjs | t.1074; Recall Q3 (still misses) | Keep |
| handoff-message-structure | on demand (file) | The one-message continuation handoff shape | closeout/audit.mjs | t.875, t.920, t.2374; CHANGELOG 1.9.0 | Keep |

## Decisions (the owner, 2026-10-31)

All stances approved. Applied on branch chore/rule-review-loosen:
- Loosen 1-2: the commit-message and branch-name rules point to the hook and CI check (name-check.mjs) in place of the hand checks.
- Loosen 3: approve.mjs widens the trial review to every 20 approvals after two clean reviews in a row, and back to 10 after any other pause (tested).
- Loosen 4: the pre-compact size table takes its whole-file rows from `tracking-check.mjs caps`.
- Merge: recovery-protocol and what-this-file-is-not are now subsections of session-workflow; their IDs and pointers stay.
- secret-shapes.mjs: rebuilt as the branch secret scan on the commit check's patterns (one home: secret-patterns.mjs), failing on a hit and never printing a value (tested). CI runs it once the CI workflow is on main.
