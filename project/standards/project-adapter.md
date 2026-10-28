<!-- Written by kit.mjs build from rules/project-adapter.md, in the layout of the Claude Code memory docs (code.claude.com/docs/en/memory). In the kit, edit the source, not this file. In a project, fill the adapter slots here; install keeps your changes, and fold-back carries rule changes back to the kit. -->

# Project Adapter

## Project Adapter (FILL-IN TEMPLATE) {#project-adapter}

Leave `<...>` visible until filled, so a gap is obvious.

| # | Field | Read by | Value |
|---|---|---|---|
| A1 | Project name + one line | Start Here, handoff | `<PROJECT NAME>` - `<line>` |
| A2 | **Domain hard boundaries** (legal, licensing, product lines; content sourcing rules) | Tier 0, delegated decisions, sweep dim 3, brief block | `<fill in>` |
| A3 | **Security baseline** + platform controls (e.g. CSP, integrity pinning, third-party code policy) | Security | `<fill in>` |
| A4 | **Data boundary** (where personal data may live / never go) | Tier 0, red-team, sweep dim 1 | `<fill in>` |
| A5 | Product red lines (e.g. no ads, no trackers, no telemetry) | Tier 0 | `<fill in>` |
| A6 | **Stack** (languages, frameworks, runtimes, package manager + version) | Code Standards | `<fill in>` |
| A7 | File naming, linter / formatter, import grouping | Code Standards | `<fill in>` |
| A8 | Test layout and runners | TDD | `<fill in>` |
| A9 | **Commands:** lint / format / type-check / unit / E2E / build / audit / full gate | Pre-Commit, CI Gate, team field 2 | `<fill in>` |
| A10 | CI workflow files; CI-only scanners | CI Gate | `<fill in>` |
| A11 | Tool-shell command prefix | Loop, team field 3 | `<fill in>` |
| A12 | **Size budgets** + check commands + CI drift margin | Size Budgets | `<fill in>` |
| A13 | Safe logger + error-code lint rules | Code Standards | `<fill in>` |
| A14 | Git split + push guard + its check | Edit Discipline | `<fill in>` |
| A15 | Commit hook + commit-message check | Commit format | `<fill in>` |
| A16 | PR body ceilings + audit commands | PR Body Standard | `<fill in>` |
| A17 | Release format + release audit | Release Notes | `<fill in>` |
| A18 | **Deploy model** (on merge vs by hand; where secrets live) + post-merge checks + runbook | Post-Merge Check | `<fill in>` |
| A19 | Preview builds (how reached / switched on, who does what) | Preview Test | `<fill in>` |
| A20 | **Test devices** (owned; what is NOT verifiable and must be labelled so) | Op-Test, Preview, visuals | `<fill in>` |
| A21 | Visual check set (widths, themes, forced colors, engines) + mockup location | Visual, Op-Test | `<fill in>` |
| A22 | Docs locations (spec, ADRs + index, plans, components, sweeps, engineering docs, archive) | many | `<fill in>` |
| A23 | Owner's shell + quirks (chaining, quoting, multi-line text to native tools) | handoffs | `<fill in>` |
| A24 | Delivery contexts (optional; each feature declares its target context at design lock and is built to that context only) | design locks | `<fill in or n/a>` |
| A25 | Live services a dev server can reach (block in scripted walks) | Security, Op-Test | `<fill in>` |
