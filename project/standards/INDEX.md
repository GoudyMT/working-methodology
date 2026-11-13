<!-- Written by kit.mjs build from rules/ (every module) (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Rule Index

Every rule by its fixed ID. A pointer `rule:<id>` anywhere in this project means: find the ID here, then read
that rule in the file named. To search, look for your words in the Rule and Also called columns.

| ID | Rule | File | Also called |
|---|---|---|---|
| multi-agent-discipline | Multi-Agent Discipline | `standards/agent-teams.md` | agents, subagents, parallel, swarm, fan-out |
| swarm-contract | The Swarm Contract (NO swarm without one) | `standards/agent-teams.md` | many agents, roles, review agents, approval table |
| patterns-and-dispatch | Patterns and Dispatch | `standards/agent-teams.md` | dispatch, sessions, prongs, worktrees |
| agent-role-table | Agent Role Table | `standards/agent-teams.md` | agent roles, access, tools, permissions, preloaded rules |
| agent-canary | Agent Canary | `standards/agent-teams.md` | confirmation phrase, canary, drift check, close out, hand-off, respawn |
| agent-team-adapter | Agent-Team Build: Project Adapter (TEMPLATE) | `standards/agent-teams.md` | agent team, builders, checkers, brief rules |
| code-standards | Code Standards | `.claude/rules/code.md` | code style, naming, comments, conventions |
| size-budgets | Size Budgets: Trim Before You Ask | `.claude/rules/code.md` | bundle, bytes, bloat, over budget, trim |
| critical-rules-priority-index | Critical Rules Priority Index | `AGENTS.md` | priorities, most important, which rule wins |
| instruction-priority | Instruction Priority | `AGENTS.md` | conflict, which instruction wins, override |
| owners-rules | The Owner's Rules | `AGENTS.md` | owner, preferences, standing orders |
| collaborative-design-locks | Collaborative Design Locks (Non-Negotiable) | `AGENTS.md` | decide, lock, options, approval, one issue, bulk instructions |
| goal-before-mechanism | Goal Before Mechanism | `AGENTS.md` | goal, purpose, why, mechanism, options |
| delegated-decisions | Delegated Decisions (amends rule 1) | `AGENTS.md` | decide alone, records answer, impact test |
| edit-discipline | Edit Discipline | `AGENTS.md` | edit, write code, change files, approval before writing |
| outward-acts | Git: Local Work vs Outward Acts | `AGENTS.md` | push, pull request, merge, release, tag, publish, remote |
| session-workflow | Session Workflow | `AGENTS.md` | session, start, end, workflow |
| recovery-protocol | Recovery Protocol | `AGENTS.md` | lost context, new chat, recover |
| what-this-file-is-not | What This File Is Not | `AGENTS.md` | scope of standards |
| context-engineering | Context Engineering Discipline | `AGENTS.md` | context window, tokens, load, size |
| anti-hallucination | Anti-Hallucination Discipline (Standing) | `AGENTS.md` | guess, verify, invented, made up, re-read claims |
| correction-loop | Correction & Learning Loop | `AGENTS.md` | corrections, feedback, mistakes, learn |
| autonomous-fixes | Autonomous Fixes | `AGENTS.md` | fix without asking, small fixes |
| direction-changes | Justify Every Direction Change | `AGENTS.md` | pivot, change direction, justify |
| re-plan-on-failure | Re-Plan on Failure | `AGENTS.md` | plan failed, replan |
| simplicity-lens | Simplicity Lens | `AGENTS.md` | simple, simpler, over-engineering |
| dual-horizon | Dual-Horizon Recommendations | `AGENTS.md` | short term, long term, rework cost |
| success-charter | Success Charter (Define Success Before Building) | `AGENTS.md` | success criteria, define done, measurable |
| visual-design-collaboration | Visual Design Collaboration | `.claude/rules/design-and-ux.md` | visual, layout, wireframe, mockup, screen, color, contrast |
| craft-floor | Craft Floor | `.claude/rules/design-and-ux.md` | states, empty state, heuristics, design review score, dashboard, board, anti-patterns, slop |
| design-for-human-error | Design for Human Error | `.claude/rules/design-and-ux.md` | mistakes, typo, mistype, forgiving, recover |
| diagrams | Diagrams That Explain | `.claude/rules/design-and-ux.md` | diagram, figure, architecture picture, flow chart, system map, visual explainer |
| failure-response | Failure Response Discipline (Triage Before Fixing) | `standards/evidence-and-failures.md` | failure, error, broken, triage, debug, kit status, stale kit, troubleshooting |
| enumerate-before-you-count | Enumerate Before You Count | `standards/evidence-and-failures.md` | numbers, counts, metrics, surprising results |
| instruments-and-evals | Instruments and Evals | `standards/evidence-and-failures.md` | eval, benchmark, measurement, harness, results |
| probe-scope | Probe Scope | `standards/evidence-and-failures.md` | probe, experiment, investigation scope |
| snag-response | Snag Response: Least-Invasive Path, No Padding | `standards/evidence-and-failures.md` | stuck, blocker, workaround, snag |
| blocked-prompts | Blocked on a Prompt or a Permission | `standards/evidence-and-failures.md` | permission prompt, permission block, waiting on a prompt, owner command, hung |
| fact-check | Fact-Check Before Handing Over | `standards/evidence-and-failures.md` | fact check, verify a document, claims, report, explainer, diagram accuracy |
| pre-commit | Pre-Commit Discipline | `.claude/rules/git-and-release.md` | before commit, commit checks, staged |
| commit-message-format | Commit Message Format | `.claude/rules/git-and-release.md` | commit message, subject line, type |
| branching | Branching | `.claude/rules/git-and-release.md` | branch name, naming, git branch |
| pr-body | PR Body Standard | `.claude/rules/git-and-release.md` | pull request description, pr text, body |
| release-notes | Release Notes | `.claude/rules/git-and-release.md` | release, changelog, version notes |
| post-merge-check | Post-Merge Check | `.claude/rules/git-and-release.md` | after merge, deploy check, live |
| kit-stays-local | Kit Stays Local | `.claude/rules/git-and-release.md` | kit not committed, exclude, track growth, never list, private |
| first-push-gate | First Push Gate | `.claude/rules/git-and-release.md` | first push, new remote, initial push, tracked files check, history |
| standing-grants | Standing Grants | `.claude/rules/git-and-release.md` | grant, autonomy, autopilot, kill switch, act without asking, automatic release |
| kit-standards | Kit Standards (How the Methodology Improves) | `standards/kit-standards.md` | kit, methodology, change a rule, briefs, one home, improvement report, process gap, kit gap, missing kit, kit gate |
| loop-workflow-mode | Loop Workflow Mode (Keyword-Gated TDD Loop) | `standards/loop-mode.md` | loop, autonomous, keyword |
| graduated-loop-lessons | Graduated loop lessons | `standards/loop-mode.md` | lessons, learned, regression |
| project-adapter | Project Adapter (FILL-IN TEMPLATE) | `standards/project-adapter.md` | project values, stack, adapter, fill in |
| finding-pipeline | The Finding Pipeline (Sweep Finding -> Fix) | `standards/reviews-and-findings.md` | findings, review results, fix findings, triage |
| features-first | Features First; Findings Ride Inside the PR | `standards/reviews-and-findings.md` | fix-only pr, findings in the pr |
| milestone-sweep | Milestone Project Sweep (Periodic Multi-Agent Audit) | `standards/reviews-and-findings.md` | audit, sweep, milestone, review dimensions |
| sweep-tiers | Sweep Tiers | `standards/reviews-and-findings.md` | sweep size, light sweep, fix sweep, triage sweep, feature sweep, launch gate, first push |
| sweep-auto-approval | Sweep Auto-Approval | `standards/reviews-and-findings.md` | approve sweep, swarm contract approval, automatic approval, sweep trial |
| pre-pr-deep-sweep | Pre-PR Deep Sweep | `standards/reviews-and-findings.md` | before pr, deep review, security agents |
| pre-push-op-test | Pre-Push Op-Test | `standards/reviews-and-findings.md` | use the app, break it, manual test, before push |
| preview-test | Preview Test Before Merge | `standards/reviews-and-findings.md` | preview link, staging, version url |
| visible-tracking | Visible Tracking | `standards/reviews-and-findings.md` | progress, checklist, visible |
| parking-lot | Parking Lot + Pre-PR Idea Triage | `standards/reviews-and-findings.md` | ideas, later, out of scope, parking lot |
| security-standards | Security Standards | `standards/security.md` | security, secrets, privacy, owasp, keys, install from a repo, third-party plugin, prompt injection |
| mid-design-red-team | Mid-Design Red-Team (Security Before Lock) | `standards/security.md` | red team, threat, attack, design review |
| tdd | Test-Driven Development (TDD) | `.claude/rules/testing.md` | test first, test-driven, red green, write tests |
| ci-gate | CI Gate | `.claude/rules/testing.md` | ci, pipeline, checks, green |
| test-lanes | Test Lanes | `.claude/rules/testing.md` | slow tests, fast lane, test size, ci budget, large test |
| test-and-review-cadence | Test and Review Cadence | `.claude/rules/testing.md` | when to run tests, hook, full gate, review |
| sub-agent-verification | Sub-Agent Verification Step | `.claude/rules/testing.md` | agent results, verify agent, check builder |
| test-integrity | Test Integrity (Tests Never Yield to Implementation) | `.claude/rules/testing.md` | failing test, weaken, skip, assertion |
| test-value | Test Value (Practical Tests, Not Test Counts) | `.claude/rules/testing.md` | useful tests, fluff, test count, coverage |
| word-pins | Word Pins (Behaviour, Not Sentences) | `.claude/rules/testing.md` | exact wording, sentence regex, message text, snapshot |
| sdd-triangle | Spec-Driven Development (SDD) Triangle | `.claude/rules/testing.md` | spec, drift, adr, superseded |
| tracking-file-size-caps | Tracking File Size Caps (Hard Limits) | `.claude/rules/tracking-and-handoff.md` | size limit, too long, line limit, log length, tracking files |
| session-log-compression | Session Log Compression Pattern | `.claude/rules/tracking-and-handoff.md` | compress, old entries, history, log |
| tracking-file-functions | Per-Tracking-File Unique Function + Anti-Duplication | `.claude/rules/tracking-and-handoff.md` | tracking files, duplicate, restate, pointer, one job |
| status-files-rot-silently | Status Files Rot Silently | `.claude/rules/tracking-and-handoff.md` | stale, out of date, status |
| tracking-file-batching | Tracking-File Batching | `.claude/rules/tracking-and-handoff.md` | when to update, batch updates, milestone |
| decision-documents | Engineering Decisions Documents (Optional, Public Repos) | `.claude/rules/tracking-and-handoff.md` | decisions, public repo, engineering notes |
| compact-ritual | Pre-Compact and Post-Compact Hygiene Ritual | `.claude/rules/tracking-and-handoff.md` | compact, compaction, closeout, end of session, pr merged, release out |
| pre-compact-scan | Pre-Compact Scan | `.claude/rules/tracking-and-handoff.md` | before compact, scan, closeout checks |
| post-compact-orientation | Post-Compact Orientation Protocol (MANDATORY first action) | `.claude/rules/tracking-and-handoff.md` | after compact, resume, re-read, orientation |
| handoff-message-structure | Handoff Message Structure | `.claude/rules/tracking-and-handoff.md` | handoff, continuation, summary, next session |
