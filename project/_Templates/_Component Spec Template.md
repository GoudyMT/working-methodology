# Component Spec Template

Use this format for every new component design doc in `<docs/components/>`.

**Filename:** `<component-name>-spec.md` (kebab-case).

---

```markdown
# Component Spec: [Component Name]

- **Version target:** [vX.Y]
- **Status:** [proposed | designing | implementing | testing | shipped | deprecated]
- **Owner:** the owner
- **Created:** YYYY-MM-DD
- **Last Updated:** YYYY-MM-DD
- **Related ADRs:** [list]
- **Spec section reference:** [link to the master design spec section that defines this component]
- **Target context (if the project uses delivery contexts):** [context]

## Purpose

[1-2 sentences. What does this component do? Why does it exist?]

## Scope

**In scope:**
- [What this component is responsible for]

**Out of scope:**
- [What it is NOT responsible for - prevents scope creep]

## Inputs and Outputs

**Inputs:**
- [What it receives: types, sources]

**Outputs:**
- [What it produces: types, destinations]

## Dependencies

**Depends on:**
- [Other components / libraries / external services]

**Depended on by:**
- [Components that use this one]

## Public Interface

[Type signatures, API surface, exported functions / classes. Be specific; the implementation must match this.]

```<language>
// Example
export interface Item {
  id: string;
  title: string;
}

export function buildItems(input: Input): Item[];
```

## Behavior

[What the component does under various conditions.]

### Happy path
- [...]

### Edge cases
- [...]

### Failure modes
- [...]

### Human error
- [Exact-entry fields: how a person sees and fixes a typo; how a person who forgets recovers - rule:design-for-human-error]

## Data Model

[Schemas, types, persistence shape. What is stored where.]

## Security Considerations

[Work through `_Templates/_Component Security Checklist.md` and capture findings here. Mandatory even when "no personal data, no auth, no third party" - say so explicitly.]

- **Input validation:** [...]
- **Output encoding:** [...]
- **Auth / authz impact:** [...]
- **Personal-data surface:** [...]
- **Logging discipline:** [...]
- **Third-party deps:** [...]
- **Platform security policy compliance:** [...]

## Testing Plan

[Each test names the real use or failure it guards - rule:test-value.]

**Unit tests:**
- [Acceptance criteria as test specs]

**Integration tests:**
- [Boundaries with other components; contract tests]

**E2E tests (if user-facing):**
- [Critical user paths]

## Performance Targets

- [Latency, memory, bundle-size impact against the project's budgets]

## Implementation Notes

[Library choices, algorithm trade-offs, gotchas. Notes for the implementer, not the implementation.]

## Open Questions

[Things not yet decided. Must be empty before status moves to "implementing".]

## Revision History

- YYYY-MM-DD - Created
- YYYY-MM-DD - Status -> implementing
```

---

## Rules

- **One component per spec.** A component that needs sub-specs is probably 2+ components.
- **Public Interface comes BEFORE Implementation Notes.** The contract first; the implementation serves it.
- **Security Considerations is mandatory.**
- **Testing Plan written BEFORE implementation** (TDD).
- **Open Questions must be empty** before "designing" -> "implementing".
- **Revision History tracks status transitions.** Append-only.

---

## What Doesn't Go Here

- Implementation code (source tree)
- Tests (alongside source)
- Cross-component architecture (master design spec or ADRs)
- Process methodology (`AGENTS.md` and the rule modules)
