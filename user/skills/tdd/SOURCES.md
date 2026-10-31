# Sources

| plugin:skill | license | kept (what, where in our files) | dropped (why) |
|---|---|---|---|
| superpowers:test-driven-development | MIT (Jesse Vincent) | Red-green-refactor, watch-it-fail with the right failure reason, minimal green, full-suite run, bug-reproduction-first, rationalization list, break-naming gate, mock rules, mutation check, when-stuck table: SKILL.md steps 2-7, references/test-quality.md | "Delete the code, no exceptions" tone softened to set-aside-and-rewrite; exception for config files (conflicts with rule:tdd); "ask your human partner" persona fluff; graphviz diagram; duplicated good/bad code samples |
| superpowers:verification-before-completion | MIT (Jesse Vincent) | Iron law and five-step gate, claim-to-proof table, red-green regression proof, agent-report check, scope-of-verification rule: SKILL.md step 8, references/verification.md | Repeated red-flag and excuse tables (redundant with the gate); wording on exhaustion and "lying" (persona) |
| engineering:testing-strategy | Apache-2.0 (Anthropic) | Pyramid, strategy by component type, what to cover and skip, test plan output: references/test-layers.md | Thin generic text, largely redundant with rule:tdd coverage targets; expanded with kit rules rather than copied |
