## Preview test - Journal lock with an optional PIN, #79 (2026-05-15)

- **Build:** the host's Version URL for `feature/journal-lock-pin` at `9a1d6e20` (version `c3f07b58`), turned on by the
  owner; the lead opened the link first and walked it in emulation before handing it over.
- **Who, by stakes:** the lead in emulation AND the owner on a real Android phone. A new surface every user meets,
  touch and keyboard behaviour on the PIN field, what the system shows in the app switcher (device-only), and the
  screen reader on the field and the wait line (rule:preview-test, the preview-test
  skill).
- **Setup:** made-up journal entries only (no real details); nothing sent from Feedback (`/api/feedback` blocked in
  the lead's run, proven by a control; the owner was asked not to send one); other apps closed as in normal use.

**The lead's part (emulation, 320 px and desktop, light and dark):**

| Check | Result |
|---|---|
| Turn on, the easy-PIN warning, unlock, wrong tries and the live wait, Lock, Change, Remove | pass |
| Locked routes (Journal, Search, Settings) show the Unlock card, nothing behind it | pass |
| Sideways scroll; console | none; no errors |
| Security headers; service worker | same as production; active and in control |

**The owner's part (real phone, 2026-05-15 ~15:20 UTC):**

| Check | Result |
|---|---|
| Every flow above once on the phone | "Everything looks to be working as intended." |
| App switcher, at once and after 16 min, on the real Journal and the Unlock card | no journal text readable either time |
| PIN field: a save-password prompt after Unlock, after an app switch, after navigating away | none, on both keyboards tried |
| PIN field: a suggestion strip over the field | none |
| Screen reader on the field and the wait line | the field reads "PIN, edit box", not the digits; the wait line read once |

- **Decisions the results settled:** the app-switcher cover was NOT built (its condition, readable text in the
  switcher, was not met); the PIN field's fallback design was not needed (the owner: "No to both.").
- **Shots:** the lead's 320 px and desktop shots of each flow, light and dark, posted in the thread; none from the
  owner's phone (journal text stays on the device).
- **Result:** PASS. Merge on the owner's go.
- **Not verified:** iOS Safari (no Apple device in the test set); recorded NOT VERIFIED in the PR body.
- **Plan:** `docs/plans/2026-05-02-journal-lock-pin.md` (Progress, "Preview test" record).
