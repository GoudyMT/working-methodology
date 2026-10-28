# ADR-021: Static Analysis (SAST) via Semgrep OSS

- **Status:** accepted
- **Date:** 2026-04-22
- **Deciders:** the owner
- **Related ADRs:** [ADR-006](006-license-mit.md) (licence / eventual public repo), [ADR-009](009-deferred-security-hardening.md) (deferred security hardening), [ADR-019](019-stateless-sync-service.md) ($0 operator cost)

## Context and Problem Statement

The v1.0 Launch Gate requires SAST (static application security testing) on every PR (Working Standards "Security Standards"; design spec section 6). CI has no SAST scanner today - `.github/workflows/` holds only `ci.yml` (the 9-gate `test` job) and a gitleaks `secret-scan` job. ESLint plus the custom `eslint-plugins/local` rules enforce the project's privacy patterns, but they are pattern lint, not security dataflow analysis. Which SAST tool closes the gap, given the repo is currently PRIVATE and must stay $0 to operate?

## Decision Drivers

- Launch-gate requirement: SAST on every PR.
- $0 operator cost + solo-maintainable (ADR-019): no paid tier.
- **The repo is currently private.** CodeQL code scanning on a private repo requires paid GitHub Advanced Security, and the CodeQL CLI license forbids private + CI use without it - both verified against GitHub's docs and the CLI license. That rules CodeQL out entirely at $0.
- Complement, not duplicate, the existing ESLint/`local` rules.
- Privacy: the scanner must not upload our code or send telemetry.

## Considered Options

1. **Semgrep OSS (Community Edition)** - a CLI scan in CI.
2. **CodeQL** (GitHub-native) - advanced setup workflow.
3. **CodeQL CLI without the code-scanning upload** - run the engine, emit SARIF as an artifact.
4. **ESLint security plugins** (eslint-plugin-security) - rules in the existing lint gate.
5. **No SAST** - rely on ESLint/`local` + review. (Rejected: fails the launch-gate requirement.)

## Decision Outcome

**Chosen option:** Option 1 - Semgrep OSS. A `semgrep` workflow runs `semgrep scan --config p/default --metrics=off` on every PR + push to `main` + a weekly schedule.

### Why

The repo is private and must stay $0, which eliminates every CodeQL path: private-repo code scanning is a paid GitHub Advanced Security feature, and the CodeQL CLI license forbids use with a private repo and during automated analysis, CI or CD without a paid license - so even option 3 (CLI without upload) is a license breach, not a loophole. Both were verified against GitHub's own documentation and the CLI's LICENSE, after an initial CodeQL attempt failed in CI with "Code scanning is not enabled for this repository."

Semgrep OSS fits every constraint, verified by installing it and scanning this private repo locally: it needs no account or token for `semgrep scan` (only the platform's `semgrep ci` does), it never uploads code, `--metrics=off` sends no telemetry, and it runs natively cross-platform (including Windows, so it is locally reproducible). It runs pattern + dataflow rules over JS/TS - real coverage ESLint's pattern rules lack (option 4 is a weaker fallback, JS/TS-only). Opengrep (a Semgrep fork) is viable but a smaller ecosystem with no advantage here.

**Advisory first, blocking later.** `semgrep scan` exits 0 on findings by default; adding `--error` makes it block. The first local scan (`p/default`, 260 rules, 311 files) found 9 findings - all supply-chain config (mutable GitHub Actions tags, package-manager release-age), zero in `src/` application code. The workflow ships advisory now (findings in the job log, job green), which closes "SAST on every PR" without a red board. The 9 baseline findings are cleared in scoped follow-ups, after which the gate flips to `--error`.

### Dual-Horizon

- **Impact now:** closes the launch-gate gap at $0 with no code upload; advisory until the baseline is cleared.
- **Impact later:** durable while the repo is private. If the repo goes public, CodeQL becomes free and can be added beside Semgrep or swapped in; the policy test pins the triggers and permissions, not the tool, so either path is additive. No retirement trigger.

### Consequences

**Positive:**
- Closes the launch-gate SAST gap with a free, private-repo-compatible, privacy-clean scanner (no code upload, no telemetry).
- Locally reproducible on Windows, so the baseline is known before CI runs - no ship-then-discover.
- Independently surfaced real supply-chain findings (it confirmed the mutable-action-tag item already on the backlog).

**Negative:**
- Findings live in the CI job log, not a GitHub Security tab (which needs paid GHAS on a private repo anyway).
- The ruleset is fetched from Semgrep's registry at scan time - a runtime dependency on that registry. Rules can be vendored later if needed.
- Advisory until the baseline is cleared + the `--error` flip; until then findings do not fail the build.

**Neutral:**
- `p/default` also carries supply-chain/config rules that overlap Dependabot/gitleaks concerns; harmless while advisory, and the ruleset is tunable.

## Pros and Cons of the Options

### Option 1: Semgrep OSS
**Pros:** $0 on a private repo; no token; no code upload; no telemetry with `--metrics=off`; native Windows so locally reproducible; real JS/TS coverage. **Cons:** findings in the log not a Security tab; registry runtime dependency.

### Option 2: CodeQL (advanced setup)
**Pros:** GitHub-native, deep dataflow, Security-tab integration. **Cons:** private-repo code scanning is paid (GHAS); ruled out at $0. Verified in CI ("Code scanning is not enabled") + docs.

### Option 3: CodeQL CLI without upload
**Pros:** would keep CodeQL's engine at $0. **Cons:** the CLI license forbids private + CI use without paid GHAS - a license breach, not a workaround.

### Option 4: ESLint security plugins
**Pros:** lightest (no new job), $0. **Cons:** pattern-only, JS/TS-only; weaker than Semgrep's dataflow. A fallback.

### Option 5: No SAST
**Cons:** fails the launch-gate requirement.

## Implementation Notes

- `.github/workflows/semgrep.yml`: a third workflow (peer to `ci.yml`'s `test` and `secret-scan` jobs). Checkout + `pip install semgrep` on ubuntu (not the container image - avoids checkout-in-container quirks) + `semgrep scan --config p/default --metrics=off`. Scoped `permissions: contents: read` (no upload). A `concurrency` group cancels superseded runs.
- `src/lib/ci/sast-policy.test.ts`: locks the workflow's triggers (PR + push to `main` + schedule), the least-privilege `contents: read`, and that the scan runs a ruleset with `--metrics=off` - not the advisory/blocking flag, so the `--error` flip does not break the test.
- Baseline cleared + blocking live: actions SHA-pinned; a github-actions Dependabot cooldown added; the remaining release-age findings excluded as reviewed policy (`--exclude-rule`, justified inline in the workflow); `--error` on.

## References

- Design spec section 6 (threat model / security); Working Standards "Security Standards".
- GitHub Advanced Security billing (private-repo code scanning is paid); CodeQL CLI LICENSE (private + CI restriction); Semgrep OSS CLI docs (no token; code never uploaded).
- ADR-006, ADR-009, ADR-019.

## Revision History

- 2026-04-22 - Created as CodeQL, then revised to Semgrep OSS the same day. The CodeQL choice rested on an unverified "public repo" premise; the repo is private, and CI plus GitHub's docs + the CodeQL CLI license proved CodeQL cannot run on a private repo at $0. Semgrep OSS was verified locally (9 supply-chain findings, 0 code vulns) before locking.
- 2026-04-22 - Flipped to blocking. Baseline cleared: SHA-pinned all GitHub Actions (7 findings), added a cooldown to the github-actions Dependabot ecosystem (1). The one remaining finding - the package manager's release age at a deliberate 24h vs the rule's 7 days - is reviewed, intentional policy, excluded via `--exclude-rule` with justification inline (the owner's call: keep the sound 24h floor and suppress rather than change policy to satisfy the scanner; Dependabot already cools down 7 days). Final scan: 0 findings, `--error` exits 0. The SAST gate now blocks on findings.
