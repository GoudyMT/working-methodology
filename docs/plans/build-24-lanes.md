# lanes

## Units

| Id | Files | Runs |
|---|---|---|
| U9 | `user/kit-hooks/holds.json`, `project/.claude/guard.cjs`, `user/kit-hooks/agent-model.cjs`, `tests/holds.test.mjs` | parallel |
| U4 | `user/kit-hooks/edit-fence.cjs`, `.githooks/pre-push`, `user/skills/agent-team-build/SKILL.md`, `tests/test-lock.test.mjs` | after U9 |
| U2b | `user/skills/pre-pr-sweep/approve.mjs`, `user/kit-hooks/handoff-gate.cjs`, `user/agents/builder.md`, `user/agents/checker.md`, `user/agents/reviewer.md`, `user/skills/agent-team-build/templates/builder-brief.md`, `user/skills/agent-team-build/templates/checker-brief.md`, `user/kit-hooks/holds.json` | after U9 |
| U6 | `user/kit-tools/handoff.mjs`, `user/agents/test-reviewer.md`, `user/skills/agent-team-build/templates/builder-brief.md`, `tests/review-gate.test.mjs` | after U2b |
| U10 | `user/kit-tools/lanes.mjs`, `user/skills/pre-pr-sweep/SKILL.md`, `user/skills/agent-team-build/SKILL.md`, `tests/lanes.test.mjs` | after U15, U4 |
| U5 | `user/kit-tools/tester-model.mjs`, `user/kit-tools/builder-model.mjs`, `user/skills/agent-team-build/templates/batch-plan.md`, `kit.config.json`, `tests/model-scripts.test.mjs` | parallel |
| U11 | `.github/workflows/ci.yml`, `scripts/mutation-check.mjs`, `tests/mutation-job.test.mjs` | after U5 |
| U13 | `AGENTS.md`, `rules/security.md`, `tests/what-holds.test.mjs` | after U11 |
| U8 | `scripts/kit.mjs`, `project/.github/workflows/ci.yml`, `tests/model-override.test.mjs` | parallel |
| U12 | `scripts/kit.mjs`, `user/skills/pre-pr-sweep/approve.mjs`, `tests/slots.test.mjs` | after U8, U2b |
| U15 | `user/skills/agent-team-build/SKILL.md`, `user/skills/agent-team-build/templates/builder-brief.md`, `user/kit-tools/handoff.mjs`, `user/kit-hooks/agent-model.cjs`, `user/kit-tools/flow-check.mjs`, `rules/agent-teams.md`, `tests/flow-lock.test.mjs` | after U6, U9, U4 |
| U16 | `user/kit-tools/handoff.mjs`, `user/skills/agent-team-build/templates/builder-brief.md`, `user/agents/tester.md`, `user/agents/test-reviewer.md`, `tests/ask-dont-guess.test.mjs` | after U15, U10 |
| U17 | `user/kit-tools/plan-check.mjs`, `user/skills/agent-team-build/templates/batch-plan.md`, `user/skills/agent-team-build/SKILL.md`, `tests/plan-check.test.mjs` | after U16, U5 |
| U18 | `user/skills/agent-team-build/SKILL.md`, `user/kit-tools/flow-check.mjs`, `user/kit-tools/handoff.mjs`, `rules/agent-teams.md`, `tests/overwatch.test.mjs` | after U17 |

U18 spec note (2026-11-22 12:39Z): the overwatch lead is the build lead (and the orchestrator), not an extra role. Its
run: plan and split into lanes; the owner's stated intent plus the plan is approval unless the plan raises a new call;
start the teams and watch them; answer lane questions and keep the JSONL checklist; spin teams down as lanes finish;
merge the lanes; run the one sweep; fix in lanes; then CI, the gate and the owner's yes. Each step is checked by a
script, hook or guard.

## After the lanes

1. U14: VERSION 1.51.0, the build record with per-unit commit lists, the changelog.
2. The one sweep on this PC, under an approved contract. The same sweep runs in the cloud as the paired sweep: the
   bench thread gets the pushed covered head sha, the contract and each role brief verbatim before the PC findings
   exist; the PC report follows. Both results are reported side by side (owner, 2026-11-22).
3. Fixes in lanes from lanes.mjs; a high, critical, security or owner-rule fix gets a failing test first.
4. CI, the score gate (rule text changed), then the owner's yes for merge, tag and release.

## Sweep inputs (found during the build, fixed in the sweep lanes)

- approve.mjs: the pipe-row refusal beside a RECORD block is case-sensitive (`High | CONFIRMED` passes); the row
  parser is case-insensitive. Add /i (automated security review).
- plan-check.mjs: an installed copy cannot import project/.claude/plan-graph.mjs (builder doubt).
- agent-model.cjs duplicates GUARD_PATHS; a test now holds the two lists equal (closed in U15 round 1).
- A lead note (second review, lead answer) is text an agent writes: a log-stage limit; a lead-only answer file
  comes before these checks enforce (build 25 list row).
- Builders keep a shell, so a test file can change outside the edit fence; commit checks and CI catch it, and
  nothing restores a deleted lock list (build 25 list row).
- Some builder briefs gave no canary phrase; the role files' rules carry it unevenly (check the brief templates).
- flow-check checklist: C19-C22 pass only through the usage exit 2, and C11's folder entries pass with folder
  matching broken (builder doubt).
