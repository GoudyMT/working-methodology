## Preview test - the download stall guards, #88 (2026-06-09)

- **Build:** the host's Version URL for `fix/download-stall-guards` at `8d1f3b7` (version `41c8e7d2`), turned on by the
  owner; the lead opened the link first and read the footer (v3.2.1) before anything else.
- **Who, by stakes:** the lead only, automated. A guardrail users rarely see: no new surface, no touch or keyboard
  change, no device-only path, no screen-reader change. The owner's phone is not needed (rule:preview-test, the preview-test
  skill).
- **Setup:** phone emulation (Pixel 7 profile and 320 px) and desktop; made-up details only; `/api/*` blocked by a
  route, proven by a control (the control call was refused before the run began); nothing sent.

| Check | Result |
|---|---|
| Home, Notebooks, Map, About, Settings draw their heading | pass, all five, at 320 px and desktop |
| Sideways scroll | none |
| Console | no errors, no warnings from the app |
| Service worker | active and in control after one reload |
| Security headers on the preview | CSP, `X-Content-Type-Options`, `Referrer-Policy` present, same as production |
| Network to `/api` | 0 calls (blocked, control proven) |
| A silent `/notebooks` (the route held open, no bytes) | opened from the kept frame in 5,042 ms (bar: 5 s + 100 ms) |
| A trickled map area (one chunk every 4 s) | not cut; finished in 41 s |

- **Shots:** 320 px and desktop for each screen, light and dark, posted in the thread.
- **Result:** PASS. Nothing to fix before merge.
- **Not covered here:** a real phone's fonts, system UI and storage (the change touches none of them).
- **Plan:** `docs/plans/2026-06-09-download-stall-guards.md` (Progress, "Preview check" box ticked with the numbers
  above).
