# Decision Record Template (MADR Format)

Use this format for every new Architecture Decision Record (ADR) in `<docs/decisions/>`.

**Filename:** `NNN-short-descriptive-name.md` where NNN is zero-padded sequential (001, 002, 003...).

**Status values:** `proposed` | `accepted` | `deprecated` | `superseded by [link]` | `rejected`

---

```markdown
# ADR-NNN: [Short decision title]

- **Status:** [proposed | accepted | deprecated | superseded by ADR-XXX | rejected]
- **Date:** YYYY-MM-DD
- **Deciders:** the owner (+ collaborators if any)
- **Related ADRs:** [links]

## Context and Problem Statement

[The issue this ADR addresses. What question is being decided? What is at stake?]

## Decision Drivers

- [Driver 1: e.g. "Privacy must be architectural, not policy"]
- [Driver 2: e.g. "Solo developer velocity"]
- [Driver 3: e.g. "Lower liability surface for the first version"]

## Considered Options

1. **Option A:** [brief description]
2. **Option B:** [brief description]
3. **Option C:** [brief description]

## Decision Outcome

**Chosen option:** [Option name]

### Why

[The case for this option, grounded in the drivers. What problem does it solve? What trade-off is accepted?]

### Dual-Horizon

- **Impact now:** [cost and benefit for the current version]
- **Impact later:** [cost and benefit for future versions; durable or temporary? If temporary: the retirement trigger]

### Consequences

**Positive:**
- [What becomes easier or better]

**Negative:**
- [What becomes harder or worse; known trade-offs accepted]

**Neutral:**
- [Things that change but don't clearly help or hurt]

## Pros and Cons of the Options

### Option A: [name]

**Pros:**
- [...]

**Cons:**
- [...]

### Option B: [name]

**Pros:**
- [...]

**Cons:**
- [...]

### Option C: [name]

**Pros:**
- [...]

**Cons:**
- [...]

## Implementation Notes

[Optional. Implementation guidance, affected paths, follow-up work this decision implies.]

## References

- [Design spec section]
- [Research artifact]
- [External references]

## Revision History

- YYYY-MM-DD - Created
- YYYY-MM-DD - Status change to [status]
```

---

## Rules

- **One decision per ADR.** If tempted to bundle, split.
- **Status is mutable; the file is not deleted.** ADRs are history.
- **Filename never changes** after creation. If the decision evolves, link forward via `superseded by`.
- **Link bidirectionally.** When ADR-005 supersedes ADR-002, set ADR-002's status to `superseded by [ADR-005]` AND list ADR-002 in ADR-005's Related ADRs.
- **A code deviation from an accepted ADR** gets an inline `> SUPERSEDED (<date>): ...` marker in the SAME session if the full amendment is batched (rule:sdd-triangle, "Locked-Decision Drift Markers").
- **Considered Options must be honest.** If only one real option existed, say so and explain why - never fabricate alternatives.
- **Length:** aim for 300-800 words. Longer = bundling or padding; shorter = probably under-explained.

---

## When to Write an ADR

Write one when a decision affects the architecture (data flow, storage, technology, deployment), has long-term consequences, had several reasonable options, or a future reader will need the WHY.

Don't write one when the decision is purely tactical, was forced (no real alternative), or is already covered fully by the design spec (link the spec section instead).

---

## Index Registry

Maintain `<docs/decisions/>000-decisions-index.md` as the master index; update it with every new ADR.

---

## MADR Reference

Adapted from MADR (Markdown Architectural Decision Records): https://adr.github.io/madr/
