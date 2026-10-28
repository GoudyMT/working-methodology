<!-- Written by kit.mjs build from rules/security.md (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->

# Security

## Security Standards {#security-standards}

Top priority. The baseline, data boundary and platform controls are A3/A4.

- **Baseline:** a named verification standard (e.g. OWASP ASVS Level 2); the data boundary is architectural and tested, not policy; no trackers or analytics unless A5 allows.
- **Secrets:** none in client code or history (env files gitignored; values never printed - key names only; ids masked in diffs); keys never reach the client (a backend proxies); client-held tokens encrypted at rest; committed config uses placeholders. **A dev server may hold live secrets:** scripted walks block every outside-service route before the first page loads, proven by a control (a counter on the handler); read a route's handler for outbound calls before submitting its form. Why: a test run can send real email or spend real money.
- **Per-component checklist:** `_Templates/_Component Security Checklist.md` completed BEFORE a component is complete. Why: security reviewed last is security bolted on.
- **Dependencies:** a scheduled updater; advisories as PRs; no unaudited dependency in a critical path; an unfixable high -> confirm no patch, research removal first, else a scoped documented ignore for that one advisory (only if it cannot reach production) with a retire-when; a minimal lockfile diff after override experiments.
- **SAST** on every PR; high blocks merge; triage within a week; CI-only scanners run locally on changed files before reporting done.
- **Cadence:** a staged-diff scan before every commit (ids, secrets, keys, logging of user input, new data-gathering or egress surface), shown passing; the Pre-PR Deep Sweep before every merge.
- **No usage-scaling cost** without revenue: paid synthesis is bring-your-own-key (encrypted on the client, sent straight to the provider); an operator tier degrades to free with a hard spend cap; no providers that train on prompts.
- **Threat model** in the spec, re-reviewed each major version; novel surfaces get a mini threat model in their component spec.
- **Disclosure:** a published `security.txt` (or equivalent) with a contact and SLA (e.g. acknowledge 48 h, triage 7 days).

## Mid-Design Red-Team (Security Before Lock) {#mid-design-red-team}

**Before locking any design touching personal data, encryption, authentication or external surface, red-team it inline.** Why: a design-time flaw is a paragraph of spec; a post-build flaw is a redesign, rebuild and migration.

- **One iteration:** 3 parallel read-only red agents - **Red-A** privacy / data exposure (logs, dev tools, side channels, URLs, caches, workers, errors); **Red-B** crypto / keys (extraction, misuse, KDF weakness, downgrade, lifecycle); **Red-C** app logic (races, state corruption, replay, crafted-input DoS, schema bypass, error states) -> numbered findings with severity -> **White-D** (privacy + crypto patches) and **White-E** (logic + cross-cutting) -> the controller integrates.
- **A safety-critical LLM prompt** gets its own red-team (misattribution, gate evasion, scope, delimiter forgery, refusal) plus a novel-lens slot; some fixes belong in code (structure that makes forgery impossible), not prose.
- **Three iterations,** fresh top-tier agents each; **converged** when the last finds no new whole-mechanism gap (not zero findings); a new one in round 3 -> one more round; another -> back to Plan. Each finding-patch pair is then LOCK (fixable, cost <= value) / DEFER / DOCUMENT-ONLY (inherent) / GOVERNANCE.
- **Scope:** the design, the locked foundation under it (structural findings -> ADR supersession), its integration points. **Apply** to data, crypto, new external surface, or on request; **not** to pure presentation, untouched internals, or property-preserving refactors.
- **Capture** each finding where its patch lives AND in the spec's Security Considerations (finding, severity, fix, status).
