## Commit hook: run server and related browser tests on commit

Every commit ran the whole unit suite. Now the quick server project runs whole and the slow browser project
runs only the tests related to the staged code; the full gate and CI still run everything.

**Changes**
- The hook picks what to run from the staged paths; a config, workflow, lockfile, any file outside the
  source folders, or any deletion still runs everything.
- Each step keeps the old deadline, so a slow run still fails loudly.
- Each selection rule has a test that fails when the rule is removed.

**Gates**
- [x] Full local gate 18/18 green on the head.
- [x] A one-file commit took 38 s, down from about 2 to 3 minutes.
- [x] Reviewed for privacy, supply chain, legal and licensing, and code security; no secrets or account
  information; the gaps the review found (tests that read source as text, deletions) are fixed.

**Notes** - Tooling only; the app does not change.
