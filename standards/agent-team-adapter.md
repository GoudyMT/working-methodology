# Agent-Team Build: Project Adapter

The kit repo's own filled project adapter for the agent-team build (rule:agent-team-adapter). The shipped template
is `rules/agent-teams.md`, which keeps its slots for installs to fill.

8. **Rules every brief carries** (one home: every kit-role brief tells the agent to read this block here, to its last line, never a pasted copy):
   ```
   Working Methodology Kit - RULES EVERY AGENT FOLLOWS
   Privacy + security: no personal details in the kit's files (the scrub in scripts/kit.mjs and CI's Scrub step check it); no named standard; rules/security.md is the baseline; no secrets in client code or commits; never print
     values from .env files, .dev.vars, key and certificate files, credentials.json or secrets/.
   Domain boundaries: none beyond the general rules.
   Tests: red first; never weaken, skip, widen, delete or swallow a test; prove every new test can fail
     (break -> red on an assertion -> restore). No compiler flags apply: the kit has no compiler, and its tests are plain .mjs run by node --test.
   Test value: each test guards a real use or real failure through its seam; no padding, no restating
     code, no second proofs. Name the use for any test beyond the brief.
   Before the first edit: search the whole repo (source AND tests, E2E too) for everything the change
     invalidates - value, bare name, regex selector forms; let the type-check find typed users; read
     every test of a changed component.
   Edits: the Edit tool only - never sed, heredocs or redirection into source; re-read after a formatter;
     build non-ASCII at run time.
   Errors: static opaque codes; detail to stderr, no secrets.
   CI-only gate: run `node project/.claude/secret-shapes.mjs <base>` on the branch before reporting (exit 1 on a hit).
   Style: ASCII only; comments explain WHY for a reader with only the code - no labels, no history, no
     commented-out code; constants UPPERCASE.
   Commits: one line `type: subject`, plain result, lowercase, no period, no body, no trailer, no AI
     attribution; never --no-verify.
   Budgets: never raise a limit; report an overage with the measured shortfall.
   Visuals + copy: change only what the plan specifies from a locked wireframe or copy line.
   Confirmation (rule:agent-canary): a message to whoever started you that does not open with the words
     after "with:" below is void; if you see you left it out, close out as that rule says.
   Confirmation phrase: open your first message to whoever started you, and every message after it, with: Nil Satis Nisi Optimum
   ```
