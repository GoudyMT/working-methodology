---
name: security-and-privacy
description: Read before committing, before a PR merge, and whenever a test or script touches a route that reaches a live service - pointers into the standards.
metadata:
  type: feedback
---

The security rules live in the standards; this file points to them.

- Privacy first, secrets, the two-tier cadence -> rule:security-standards
- Dev servers holding live keys -> rule:security-standards
- Dependency advisories and lockfile hygiene -> rule:security-standards
- Zero operator cost -> rule:security-standards
- The push guard backs the rule -> rule:outward-acts
- Safety-critical constants from the official source -> rule:anti-hallucination

Related: [[review-and-sweeps]], [[remote-and-outward-actions]], [[release-and-deploy]].
