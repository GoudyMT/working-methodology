## Live check: an automatic alarm for online search, a data date on About, and cooking class links

Three changes that keep the app honest with no one running it. Releases as v2.4.0.

### Summary

| Where | Before | After |
|---|---|---|
| After a merge | A person searched the live site for a recipe by hand | CI runs a search after every push to main, weekly, and on demand; it fails if results come from the wrong recipe index |
| About, Data | No date | "Nutrition data captured from Mar 3, 2026 to May 12, 2026", from the source registry |
| Meal plan, first week step | One link (the public food guide) | Also two free community cooking classes |
| Resources page | "trusted nonprofits" | "trusted free programs": one class is free but run by a company |
| Engineering doc 03 | No payment method; a manual check | The real cost guarantee; the automatic check |

### Included

<details>
<summary>Where the change lives</summary>

- `.github/workflows/live-check.yml` and `scripts/live-check*.mjs` (new).
- `src/lib/sources/`, `src/routes/about/`, `src/lib/resources/`, `src/routes/resources/`.
- `docs/engineering/03-online-search.md`, the size limits, the version.

</details>

### Design decisions

- **Fail closed, but not on a blip:** one retry for a dropped connection; never a retry for the wrong index.
- **No install in the check:** Node built-ins only, so nothing from the registry runs in that job.
- **Dates formatted at build time,** so About ships no date code. A source with no capture date stops the
  build.
- **Known limit:** a data refresh that keeps the same index version is invisible to the check; the
  workflow says so.
- **Size limits raised by the owner** for the About sentence.

### Verification

- The live check passed against the live site.
- About, Resources and the meal plan step walked on a production build: both engines, 320 px and desktop,
  light and dark, no sideways scroll.

<details>
<summary>Every gate</summary>

| Check | Result |
|---|---|
| Dependency audit | 0 high (2 documented scoped ignores) |
| Lint; type check | pass |
| Static scan | 0 findings |
| Unit | pass |
| E2E | pass on chromium and webkit, slow suite included |
| Build; bundle | pass |
| Chunks | within the raised limits |
| Lighthouse | pass |

</details>

### Review

Reviewed across privacy and the PII boundary; code security, including the new workflow; supply chain and
bundle; legal content and licensing, with every new claim checked; test value; scaling; and version alignment.

Result: no critical or high finding; the one limit is named above.

| Pass | Outcome |
|---|---|
| Deep review | fixed here |
| Short re-check of the fixes | one low, fixed here |
| Hands-on check | no defects |

<details>
<summary>Verified clean and enumerated rather than asserted</summary>

- The check sends one fixed public search with a read-only token, and a fork cannot start it.
- The cooking class links are not health or diet advice links.
- No new package; the corpus and the served documents are unchanged (the recipe index included).
- No secrets or account information in the diff.

</details>

Scaling: no per-use cost.

Version alignment: YES. It serves the goal of an app that keeps working with no one operating it.
