# Budget Book v2.4.0

Know how current the exchange rates are, and find a money coach.

A feature release. About now says when the app's exchange rates were captured, and the first-budget step on the
Plan page points to two free money coaching programs. Behind the scenes, the app now checks its own online
rate lookups.

**Try it: https://budget.example**

## What changed

- **A date on the rates.** About, Data: "Captured from Mar 3, 2026 to May 12, 2026." Each conversion shows
  the rate as it read then, and each central bank's official page has the latest.
- **Coaches on the first-budget step.** The step for setting up your first monthly budget now links two free
  programs that pair you with a volunteer money coach.
- **Online lookups check themselves.** After every update and once a week, the app's own build checks that
  online rate lookups still work, and tells the maintainer if they do not.
- **Clearer wording.** The Resources page now calls the links that are not from a public body "trusted free
  programs".

Size grows: the offline install is about 150 bytes larger, the new About sentence.

## Unchanged

Privacy, security, and licensing hold as they did in v2.3.0: your accounts and entries stored locally and
encrypted, no trackers, no ads, an online path that stays off until you turn it on, MIT license, and a rate
table drawn only from public central bank data.
