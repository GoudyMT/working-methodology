# Pre-PR Sweep (fix tier) - The download stall guards, #88 (2026-06-09)

- **Tier:** fix (a change to how existing downloads end; no new surface).
- **Covers:** 7c2e19b4a1d05f63e8b27c90d4f1a6e35b8c2d07 (the fix check's HEAD)
- **Scope:** `fix/download-stall-guards` at `7c2e19b4` (8 commits): a download that goes silent gives up and lands on
  the app's existing failure path (map areas, a notebook export, the photo viewer, the saved check, page loads and
  other network-first files).
- **Roles:** set at plan approval; S1 (the fix and whether it holds), S2 (its blast radius: every caller and
  the code it was modelled on) and S3 (test value), each read-only, 60-call ceiling, at most 8 findings.
- **Alignment verdict (S2): YES.** The change only bounds waits the app already had; no new surface, dependency or
  data flow.
- **Dimensions:**

  | Dimension | Result |
  |---|---|
  | 1 Privacy | PASS (S2): no new request, no new storage |
  | 2 Supply chain + bundle | PASS (S2): no dependency change; size limits by the owner's yes (below) |
  | 3 Legal | PASS (S2): no content change |
  | 4 Code security | S1 and S2 below |
  | 5 Gaps, scaling, test value | S3 below |
  | 6 Alignment | YES |

- **Findings:**

  | Severity | Finding | Disposition |
  |---|---|---|
  | High | The body was timed while nobody read it (S1-1 = S2-1) | FIXED 3e8a0f1 - timed only while read |
  | Medium | The photo viewer's older-copy look was unbounded | FIXED b94d2c7 - bounded |
  | Medium | The early page could be another release's | FIXED 1d07e5a - frame-only early page + cache-error fallback |
  | Medium | Network-first files on a connection that is up but silent | FIXED f62b8c3 (the owner's yes) |
  | Low | A cache read error after the wait, a dead line, test gaps, a weak E2E, comments | FIXED 1d07e5a, a5c3e90, 6e1f7b2, c08d4a9 |

- **Fix check** (the fix tier's re-sweep): each root closed; its lows fixed (the version file never served early; unread bodies
  let go) `9b3e6d1`, `e41a7c0`, `2f8d5b3`, `d76c0e8`. Every fix red first or by a planted break.
- **Gate:** 18/18 on `5a9e2c4` and again on `8d1f3b7`.
- **Sizes:** raise approved by the owner ("yes approved") `5a9e2c4`; end check trim `0c6b9e1`, limits `8d1f3b7` +
  `e2a4d90` (four builds).
- **Preview:** automated on the Version URL `41c8e7d2` (phone emulation, 320 px, desktop): five screens drew, no
  sideways scroll, no console errors, `/api` blocked (0 calls); a silent `/notebooks` opened from the frame in 5,042 ms.
- **Moved to Known issues:** offline search setup unbounded, Feedback send, import caps, the abandoned page request,
  map index fetches.
- **Plan:** `docs/plans/2026-06-09-download-stall-guards.md` (Progress).
