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
