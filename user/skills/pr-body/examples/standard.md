## Live check: an automatic alarm for online search and a data date on About

Three changes that keep the app honest with no one running it, and cooking class links. Releases as v2.4.0.

### Summary

| Where | Before | After |
|---|---|---|
| After a merge | A person searched the live site for a recipe by hand | CI runs a search after every push to main, weekly, and on demand; it fails if results come from the wrong recipe index |
| About, Data | No date | "Nutrition data captured from Mar 3, 2026 to May 12, 2026", from the source registry |
| Meal plan, first week step | One link (the public food guide) | Also two free community cooking classes |
| Resources page | "trusted nonprofits" | "trusted free programs": one class is free but run by a company |
| Engineering doc 03 | No payment method; a manual check | The real cost guarantee; the automatic check |

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
- Dependency audit: 0 high (2 documented scoped ignores).

### Review

Feature review of `9a1d6e20`.

| Dimension | Result |
|---|---|
| Privacy and the PII boundary | clean |
| Code security, including the new workflow | findings fixed here; the re-check found one low, fixed here |
| Supply chain and bundle | clean; no new package |
| Legal content and licensing, with every new claim checked | clean |
| Test value | clean |

- **High and critical findings:** none.
- **Deferred:** none.
- **Accepted risks:** the one limit named above.
- **Checked:** the check sends one fixed public search with a read-only token; a fork cannot start it.
- **Also checked:** no class link is health or diet advice; the corpus and the served documents are unchanged.
- **Secrets:** no secrets or account information in the diff.

Version alignment: YES. It serves the goal of an app that keeps working with no one operating it.
