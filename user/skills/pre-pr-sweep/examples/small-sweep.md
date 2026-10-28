# Pre-PR Deep Sweep - The download stall guards, #88 (2026-06-09)

- **Scope:** `fix/download-stall-guards` at `7c2e19b4` (8 commits): a download that goes silent gives up and lands on
  the app's existing failure path (map areas, a notebook export, the photo viewer, the saved check, page loads and
  other network-first files).
- **Contract:** approved by the owner; roles S1-S5, each Opus and read-only, 60-call ceiling, at most 8 findings.
- **Alignment verdict (S5): YES.** The change only bounds waits the app already had; no new surface, dependency or
  data flow.
- **Dimensions:**

  | Dimension | Result |
  |---|---|
  | 1 Privacy | PASS (S4): no new request, no new storage |
  | 2 Supply chain + bundle | PASS (S4): no dependency change; size limits by the owner's go (below) |
  | 3 Legal | PASS (S4): no content change |
  | 4 Security swarm | S1, S2 and S3 below |
  | 5 Gaps, scaling, test value | S5 below |
  | 6 Alignment | YES |

- **Findings:**

  | Severity | Finding | Disposition |
  |---|---|---|
  | High | The body was timed while nobody read it (S1-1 = S5-1) | FIXED 3e8a0f1 - timed only while read |
  | Medium | The photo viewer's older-copy look was unbounded | FIXED b94d2c7 - bounded |
  | Medium | The early page could be another release's | FIXED 1d07e5a - frame-only early page + cache-error fallback |
  | Medium | Network-first files on a connection that is up but silent | FIXED f62b8c3 (the owner's go) |
  | Low | A cache read error after the wait, a dead line, test gaps, a weak E2E, comments | FIXED 1d07e5a, a5c3e90, 6e1f7b2, c08d4a9 |

- **Fix check + re-sweep:** each root closed; re-sweep lows fixed (the version file never served early; unread bodies
  let go) `9b3e6d1`, `e41a7c0`, `2f8d5b3`, `d76c0e8`. Every fix red first or by a planted break.
- **Gate:** 18/18 on `5a9e2c4` and again on `8d1f3b7`.
- **Sizes:** raise approved by the owner ("yes approved") `5a9e2c4`; end check trim `0c6b9e1`, limits `8d1f3b7` +
  `e2a4d90` (four builds).
- **Preview:** automated on the Version URL `41c8e7d2` (phone emulation, 320 px, desktop): five screens drew, no
  sideways scroll, no console errors, `/api` blocked (0 calls); a silent `/notebooks` opened from the frame in 5,042 ms.
- **Moved to Known issues:** offline search setup unbounded, Feedback send, import caps, the abandoned page request,
  map index fetches.
- **Plan:** `docs/plans/2026-06-09-download-stall-guards.md` (Progress).
