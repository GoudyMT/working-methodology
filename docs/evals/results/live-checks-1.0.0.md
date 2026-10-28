# Live loading checks: kit 1.0.0 in Claude Code

Run 2026-10-28 with the claude CLI, `--setting-sources project`, in a scratch project installed from kit 1.0.0
with one test file (`tests/a.test.js`).

1. **Before any file is read** - asked whether a "Rule Modules" section and the "Test Integrity" rule are in its
   instructions. Answer: Rule Modules yes, quoting the first row (`agent-teams`, `standards/agent-teams.md`);
   Test Integrity no ("the full rule likely lives in .claude/rules/testing.md ... not loaded right now").
   So AGENTS.md loads through CLAUDE.md, and the testing module does not load by itself.
2. **After reading the test file** - asked the same about Test Integrity. Answer: yes, "Opening tests/a.test.js
   loaded the .claude/rules/testing.md rule module", quoting its first bold sentence ("NEVER compromise a test to
   pass the implementation.").
   So a path rule loads when a matching file is read.

Check 1 is the control for check 2.
