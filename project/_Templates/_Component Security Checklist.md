# Component Security Checklist

Complete this checklist BEFORE marking any component "complete", per rule:security-standards and the design spec's security section.

Copy it into each Component Spec under "Security Considerations".

---

## Required Verifications

### Input Handling

- [ ] **All external inputs validated.** User input, API responses, file contents, query params, headers - none trusted without validation.
- [ ] **Type-safe parsing.** Schema parsers that produce typed objects, not raw casts.
- [ ] **Length limits enforced** on string inputs (DoS protection).
- [ ] **Special characters handled.** Injection vectors closed via parameterized queries; path traversal closed via path validation (when applicable).

### Output Handling

- [ ] **HTML injection vectors closed.** All user-derived content escaped before rendering (use the framework's built-in escaping).
- [ ] **Attribute injection closed.** User-derived content never placed in attributes without explicit encoding.
- [ ] **No raw-HTML sinks** (`innerHTML` and framework equivalents) without explicit justification + sanitization.
- [ ] **No `eval`, `new Function`, `setTimeout(string, ...)` or equivalents.**

### Authentication and Authorization

- [ ] **Does this component handle auth tokens or sessions?** If yes, document storage location (encrypted at rest), refresh policy, revocation path.
- [ ] **Does it enforce an access boundary?** If yes, document what is protected and how.
- [ ] **Tokens encrypted at rest** before persistence.
- [ ] **No secrets in client code.** Keys never shipped to the client.

### Personal-Data Surface

- [ ] **What user data does this component touch?** Enumerate explicitly.
- [ ] **Where does that data go?** Local storage only? An external API? A backend?
- [ ] **If data crosses the network, exactly what is sent?**
- [ ] **The project's data boundary preserved?** <!-- PROJECT ADAPTER A4 -->

### Logging

- [ ] **No personal data in logs.**
- [ ] **No tokens or keys in logs.**
- [ ] **Errors carry static codes** with enough context to debug, never the sensitive payload.

### Dependencies

- [ ] **New dependencies audited** (the package manager's audit) before adding. A known vulnerability = no install.
- [ ] **Provenance verified.** Known maintainers, active project, reasonable adoption.
- [ ] **Size budget respected** (rule:size-budgets).
- [ ] **Tree-shakable imports** where the ecosystem supports it.

### Tests

- [ ] **Failure modes tested.** Auth bypass attempts, invalid input, type confusion, malformed responses.
- [ ] **Adversarial input tested.** Injection attempts, oversized payloads, malformed encodings.
- [ ] **Each security test can fail** - shown red on a break of the guard it covers.

### Platform Security Policy

<!-- PROJECT ADAPTER A3: replace with the platform's controls. Web example below. -->

- [ ] **No inline scripts** under a strict content security policy.
- [ ] **No inline styles** unless an exception is approved and documented.
- [ ] **Remotely fetched assets are integrity-pinned** (or none exist).
- [ ] **Clickjacking prevented** (`frame-ancestors 'none'` or equivalent).
- [ ] **`X-Content-Type-Options: nosniff`** set.

### OWASP Top 10 Relevance

For each item, document "not applicable" or how this component addresses it:

- [ ] **A01 Broken Access Control** - [n/a or how addressed]
- [ ] **A02 Cryptographic Failures** - [n/a or how addressed]
- [ ] **A03 Injection** - [n/a or how addressed]
- [ ] **A04 Insecure Design** - [n/a or how addressed]
- [ ] **A05 Security Misconfiguration** - [n/a or how addressed]
- [ ] **A06 Vulnerable and Outdated Components** - [n/a or how addressed]
- [ ] **A07 Identification and Authentication Failures** - [n/a or how addressed]
- [ ] **A08 Software and Data Integrity Failures** - [n/a or how addressed]
- [ ] **A09 Security Logging and Monitoring Failures** - [n/a or how addressed]
- [ ] **A10 Server-Side Request Forgery (SSRF)** - [n/a or how addressed]

### Specific to This Project

<!-- PROJECT ADAPTER A2/A5: one checkbox per domain hard boundary and product red line. Examples of the shape:
- [ ] Component stays inside the domain hard boundary <name>.
- [ ] No third-party trackers.
- [ ] No ads.
- [ ] No telemetry by default.
-->

- [ ] <fill in>

---

## Sign-Off

- [ ] All checklist items addressed.
- [ ] Findings documented in the Component Spec "Security Considerations" section.
- [ ] Tests added for every security-relevant failure mode.
- [ ] Reviewed by the owner before the component moves to "shipped".

**Reviewer:** the owner
**Date:** YYYY-MM-DD
