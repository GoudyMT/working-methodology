<p align="center">
  <img src="icon.png" alt="Orbit" width="128" />
</p>

<h1 align="center">Orbit Audit Suite</h1>

<p align="center">
  <strong>10 expert engineers. One command. Every angle covered.</strong><br/>
  A Claude Code plugin that reviews your plans and code through the eyes of specialized engineers — from design to accessibility, frontend to production readiness.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-6C47FF?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJzNC40OCAxMCAxMCAxMCAxMC00LjQ4IDEwLTEwUzE3LjUyIDIgMTIgMnoiIGZpbGw9IndoaXRlIi8+PC9zdmc+&logoColor=white" alt="Claude Code Plugin" />
  <img src="https://img.shields.io/badge/Lenses-10-24C8D8" alt="10 Lenses" />
  <img src="https://img.shields.io/badge/Skills-16-DEA584" alt="16 Skills" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## What is this?

Most code reviews are generalist — one person (or one AI) trying to catch everything. They miss things. A design engineer would have caught the dark mode gap. A performance engineer would have flagged the unbounded memory growth. An accessibility engineer would have noticed the keyboard trap.

**Orbit Audit Suite gives you all of them.** Each lens is a specialist that knows exactly what to look for in its domain, complete with project-specific gotchas and checklists. Run one lens or all ten — your call.

## Install

```bash
# Step 1: Add the marketplace
/plugin marketplace add Recusive/Orbit-plugin

# Step 2: Install the plugin
/plugin install audit-suite@orbit-plugin
```

## Quick Start

```bash
# Audit a plan before implementation
/full-audit docs/plans/my-feature-plan.md

# Audit your uncommitted changes
/full-audit

# Run a single lens
/audit-as-frontend-eng docs/plans/my-feature-plan.md
/audit-as-a11y-eng docs/plans/my-feature-plan.md
```

---

## The 10 Lenses

| # | Skill | Expert | What They Catch |
|---|-------|--------|----------------|
| 1 | `audit-as-design-eng` | Design Engineer | Visual hierarchy, design token fidelity, dark mode parity, interactive states, animation quality |
| 2 | `audit-as-ux-eng` | UX Engineer | User journey gaps, broken mental models, missing feedback, discoverability, error recovery |
| 3 | `audit-as-frontend-eng` | Frontend Engineer | React anti-patterns, Zustand pitfalls, type safety gaps, unnecessary re-renders, bundle bloat |
| 4 | `audit-as-backend-eng` | Backend Engineer | Rust error handling, concurrency hazards, resource leaks, IPC mismatches, file system safety |
| 5 | `audit-as-structural-eng` | Structural Architect | Module coupling, dependency direction, layer violations, abstraction mismatches, circular deps |
| 6 | `audit-as-repo-maintainer` | Repo Maintainer | Convention drift, missing barrel exports, naming inconsistency, dead code, import hygiene |
| 7 | `audit-as-prod-readiness` | Production Engineer | Dev/prod parity, missing error recovery, data integrity, rollback safety, deployment gaps |
| 8 | `audit-as-dx-eng` | DX Engineer | Error message quality, CLI ergonomics, keyboard-first design, config defaults, developer flow |
| 9 | `audit-as-perf-eng` | Performance Engineer | Memory accumulation, IPC latency, streaming bottlenecks, startup impact, long-session stability |
| 10 | `audit-as-a11y-eng` | Accessibility Engineer | Screen reader compatibility, keyboard navigation, focus management, ARIA compliance, contrast |

Each lens includes a **Gotchas** section — the most common failures Claude makes from that perspective — and a **Signature Section** that only that expert produces (e.g., Visual State Coverage matrix, Keyboard Navigation Walkthrough, Resource Budget table).

## The Orchestrator

| Skill | What It Does |
|-------|-------------|
| `full-audit` | Runs all relevant lenses sequentially into **one document** with master verdict, cross-cutting concerns, and deduplicated findings |

### Two Modes

**Plan Mode** — audit before you build:
```
/full-audit docs/plans/my-plan.md
```

**Repo Mode** — audit what you've built:
```
/full-audit
```
Choose from:
1. **Uncommitted changes** — working tree diff
2. **Branch vs main** — PR-level review
3. **General repo health** — broad codebase check

### Smart Lens Selection

Not every lens applies to every plan. The orchestrator reads your plan/changes and skips irrelevant lenses automatically:
- Backend-only change? Skips Design, UX, A11y
- Frontend-only? Skips Backend
- Repo Maintainer and Production Readiness always run

### Output

Everything consolidates into one file: `reviews/audit-plan-full.md`

```
Master Verdict + Cross-Cutting Concerns + All Critical Issues
──────────────────────────────────────────────────────────────
## 1. Design Engineer         ← full analysis
## 2. UX Engineer             ← full analysis
## 3. Frontend Engineer       ← full analysis
...
## 10. Accessibility Engineer ← full analysis
```

The **Cross-Cutting Concerns** section is where the real value lives — issues flagged by multiple independent lenses are systemic problems, not isolated nitpicks.

---

## Bundled Reference Skills

Five reference skills are **included in this plugin** — no extra installs needed. When an audit lens finds issues, it consults these for detailed guidance:

| Skill | What It Provides |
|-------|-----------------|
| `emil-design-engineering` | Design principles — typography, surfaces, forms, component composition, touch targets |
| `make-interfaces-feel-better` | Visual polish — concentric border-radius, optical alignment, shadows, font smoothing |
| `web-animation-design` | Animation rules — easing blueprints, timing, spring physics, GPU-only properties |
| `web-design-guidelines` | Web Interface Guidelines compliance — structured accessibility and UX review |
| `vercel-react-best-practices` | 45 prioritized React performance rules — waterfalls, bundle size, re-renders, caching |

### Which lens uses what

| Lens | Consults |
|------|----------|
| Design | `emil-design-engineering`, `make-interfaces-feel-better`, `web-animation-design` |
| UX | `web-design-guidelines`, `emil-design-engineering` |
| Frontend | `vercel-react-best-practices` |
| Structural | `vercel-react-best-practices` |
| Performance | `vercel-react-best-practices`, `web-animation-design` |
| Accessibility | `emil-design-engineering`, `web-design-guidelines`, `web-animation-design` |

---

## How It Fits Your Pipeline

```
problem-clarifier → write plan → fazxes (scope) → full-audit → implement
```

Or use individual lenses for focused reviews at any stage.

## License

MIT
