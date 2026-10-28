# ADR-014: Recipe Library Distribution - Producer-Only Static Artifacts for v1.0

- **Status:** accepted
- **Date:** 2026-03-18
- **Deciders:** the owner
- **Related ADRs:** [012](012-content-pipeline-runtime.md) (runtime), [011](011-delivery-contexts.md) (delivery contexts), [004](004-local-first-personal-data.md) (local-first personal data), [013](013-capture-and-anchor.md) (capture + anchor)

## Context and Problem Statement

The content pipeline produces the recipe library artifacts; this ADR locks how they reach the client in v1.0, and what is deliberately deferred. The shipped search cycle already locked **S-5: static same-origin delivery, no IndexedDB or CDN in v1.0.** During the pipeline brainstorm a "smart system" for the recipe photo and card library was discussed - hold it locally, check the website for a new version on a cadence (weekly/monthly), and offer an opt-in full-library download ("Cooking somewhere without signal? Download the full library for offline search"). Locking that end-state delivery model in a FOUNDATION cycle, against a consuming spec (S-5) that already opted out, would be drift from a shipped lock. The decision: what distribution contract the pipeline ships for v1.0, and what defers to a later runtime cycle.

## Decision Drivers

- Do not drift from a shipped locked decision (S-5 static delivery).
- Privacy (ADR-004): a per-tap fetch of a recipe card from a CDN leaks WHICH recipe a user opens (CDN access logs) - a leak about diet, health and household.
- The producer artifacts (captured originals + integrity manifest) are genuinely needed now for capture + the licence audit.
- Dual-Horizon: defer the consumer-side smart-system as deliberate accepted debt rather than over-build v1.0 (Simplicity Lens).
- Transport-agnostic for a later native wrap.

## Considered Options

1. **Producer-only static artifacts for v1.0**; the client smart-system deferred to a runtime cycle.
2. **Full client smart-system in v1.0** - local hold + weekly version-check + opt-in full download.
3. **Per-tap lazy-fetch** of recipe cards from a CDN (no local hold).

## Decision Outcome

**Chosen option:** Option 1. The pipeline emits, all same-origin (static hosting assets, `connect-src 'self'` unchanged):

- `library-v1.0.json` + `library-v1.0.vectors.bin` - the existing search loader contract.
- `static/library/cards/<sha256>.webp` - served, licence-cleared card images (content-addressed, immutable).
- `static/library/library.manifest.json` - the version/integrity index (`libraryVersion` + per-file sha256 + size).

v1.0 client delivery stays static per S-5. The client smart-system (local Cache/IndexedDB hold, weekly version-check, opt-in full-library download + the "Cooking somewhere without signal?" prompt) is deferred to a runtime cycle / Scaling Plan item. **Per-tap lazy-fetch is REJECTED on privacy.**

### Why

The durable PRODUCER artifacts (captured originals + the integrity manifest) are needed regardless - for capture, the source-citation gate (ADR-013), and update detection - so the pipeline ships them. The CONSUMER smart-system is a different question that S-5 already answered for v1.0 (static), so pulling it into a foundation cycle would reopen a shipped lock. Per-tap lazy-fetch is rejected outright: it would leak which recipe a user opens to CDN logs, conflicting with ADR-004 and "personal data never leaves the device." Deferring the consumer is deliberate accepted debt, not an accident.

### Dual-Horizon

- **Impact now:** ships only what capture and the licence audit need; no new network surface; no reopened lock.
- **Impact later:** TEMPORARY on the consumer side. The offline-library download is a later runtime cycle; the content-addressed files and the manifest are durable, so that cycle adds a fetch/store layer and changes no format. Retirement trigger: the library grows past what the static bundle carries comfortably, OR users ask for the offline library.

### Consequences

**Positive:**
- No drift (S-5 honored); no privacy leak; the producer artifacts ship now.
- Content-addressing + the manifest are transport-agnostic, so a native wrap swaps only the fetch/store layer, not the format.

**Negative:**
- The "download the full library for offline" UX is deferred to a runtime cycle (accepted debt; retirement trigger above).

**Neutral:**
- When the smart-system is built, prefer Cache Storage (the Settings "Erase all data" `caches.delete()` loop already tears it down); if a new IndexedDB database is used instead, it MUST be added to the Settings erase list + a test in the same cycle.

## Pros and Cons of the Options

### Option 1: Producer-only static (chosen)

**Pros:** honors S-5; no privacy leak; ships the needed audit artifacts; transport-agnostic for a native wrap.
**Cons:** defers the opt-in offline-library UX.

### Option 2: Full client smart-system in v1.0

**Pros:** richest offline experience now.
**Cons:** reopens the shipped S-5 lock; over-builds v1.0 against the Simplicity Lens; the version-check + sync surface would need its own security review now rather than when actually built.

### Option 3: Per-tap lazy-fetch from CDN

**Pros:** no upfront download; minimal local storage.
**Cons:** leaks which recipe a user opens (CDN logs) - conflicts with ADR-004 and the privacy stance; re-introduces a CDN dependency S-5 rejected.

## Implementation Notes

- The pipeline shipped the `LibraryManifest` type + `buildLibraryManifest` (pure builder) at `src/lib/pipeline/library-manifest.ts`. The actual library files are populated by the first real capture.
- `content_hash` pins the RAW original bytes (one job: licence audit + update detection); `captured_path` is the content-addressed immutable audit-copy path.
- The deferred consumer details (Cache/IndexedDB hold, version-check, opt-in download, the prompt) belong to the runtime cycle.

## References

- Pipeline spec sections 2 (decision D4), 7 (distribution): `docs/specs/2026-03-16-content-pipeline-design.md`
- ADR-011 (delivery contexts / S-5 static same-origin), ADR-004 (local-first personal data), ADR-012 (runtime), ADR-013 (capture + anchor)
- Search cycle spec (the S-5 lock): `docs/specs/2026-02-20-recipe-search-design.md`

## Revision History

- 2026-03-18 - Created (decision locked in the pipeline design brainstorm)
