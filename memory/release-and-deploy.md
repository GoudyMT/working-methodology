---
name: release-and-deploy
description: Read after a merge to main - the post-merge check, versioning, drafting and publishing a release, deploy-config drift.
metadata:
  type: feedback
---

**After a user-facing merge, draft a release** in the latest same-kind release's format; publish only on the owner's go (it is a public post).

- **Version by semver**: patch for fixes and quality, minor for new user-facing features, major for breaking change. Square it with the roadmap's version plan. Roadmap labels stay names, not tags. Ask the owner if a run's mix is unclear.
- **One release may cover two merges** on the same day.
- **Tag at the full SHA that CI tested and passed**, not the branch name. A short SHA can fail outright.
- **Publish only after the deploy landed and the post-merge online check passed.** The notes describe what people get.
- **Before creating, check the live state.** List releases first; if the tag exists, compare its body with the audited draft instead of creating. After publishing, read the live body back and diff it.
- **The version shown in the app comes from the package file**; the release audit checks tag == package version at the target commit.
- **A post accompanies a feature release only**, and only when the owner says so. Offer it in one line.

**Post-merge online check** after every merge: the live build time is after the merge, and a live call to each backend route returns the expected shape and version. A pending check whose failure is certain by design is an outage; flag it as one.

**Deploy-config principles**
- **Know what deploys on merge and what is deployed by hand.** A data index or side service deployed by hand needs its own upload and redeploy whenever its version changes; write the runbook.
- **A dashboard-only change to a setting the config file controls drifts back** on the next deploy. Durable changes go in the config file; secrets go in the platform's secret store (they persist across deploys).
- **Never commit account ids or private values** to a public repo; use placeholders and supply them at deploy.
- **Before a hand deploy, diff the local config against the committed one** with ids masked; never print raw lines holding ids.
- **Fix forward past a schema version raise.** Never roll back past a build that raised the local database version; older code cannot open it.

Related: [[outward-writing]], [[git-and-pr-workflow]], [[remote-and-outward-actions]].
