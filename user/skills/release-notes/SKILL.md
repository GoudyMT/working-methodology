---
name: release-notes
description: Draft the release notes that follow a merge that changes what users get, sized by semver, audited claim by claim, and published only on the owner's go. Use after a user-facing merge, when the owner asks for a release, a changelog entry or release notes, or before creating a git tag for a release. Serves rule:release-notes.
---

# Release Notes

Serves rule:release-notes. The project's adapter row A17 names its release kinds and audit; the project's own
release format wins over anything here.

## Steps

1. **Run the Post-Merge Check first** (rule:post-merge-check); a release follows a live system that answers.
2. **Read the sources** (rule:pr-body, "Every outward piece starts from its format"): the latest release of the
   same kind (`gh release list --limit 6`, then `gh release view <tag>`), the merged PR bodies it covers, and
   the examples below.
3. **Size the version** by semver against the version plan, and say why.
4. **Draft** from the rule below, then audit: `node <this skill's folder>/audit.mjs <notes.md> <version>`,
   and audit each claim to the file, test or measurement that proves it.
5. **Hand off** the draft, its audit result and the sources to the owner. Create the tag and publish only on
   the owner's explicit go (rule:outward-acts); after publishing, read the live body back and diff it.

## The rule

- **Match the latest release of the same kind** (feature vs quality) - read it first.
- **Lead with this release's value**, not the last post's pattern; describe the change from the last release, not unshipped mid-branch states; check every date.
- **Semver:** patch = fixes; minor = new user-facing features; major = breaking; state the reasoning against the version plan (roadmap labels are names, not tags); ask when a run's mix is unclear. One release may cover two same-day merges.
- **Public prose:** plain words - what a user gets, honest limits beside the claims they limit; no tests, tooling, bumps, AI references or vault links (summary, not tallies); each claim audited to the file, test or measurement proving it (a "used to" claim names only states a person could reach; a third-party app claim needs a measurement per app).
- **The owner publishes or approves each publish;** Claude drafts and publishes only on an explicit go. A post accompanies a feature release only, when the owner says so.
- **The work PR carries the version bump** - never a bump-only PR; with several PRs the last to merge carries it; held while the merge date is unknown. The shown version comes from the package file; the audit checks tag == package version.
- **Tag the full SHA CI tested,** never a branch or short SHA. List releases before creating (an existing tag: compare its body with the audited draft); after publishing, read the live body back and diff it.

## The audit

`audit.mjs` checks what a script can see: ASCII only, dash-free (no em dash, no double hyphen), no AI or tool
words, no links into gitignored notes, no tooling or test tallies, and that the version given matches the
`version` in `package.json` when one exists. It cannot check that a claim is true; that audit is yours.

## Examples

- [examples/feature.md](examples/feature.md) - a feature release (minor).
- [examples/quality.md](examples/quality.md) - a quality release (patch).

Both are adapted from real releases, with the product, names and numbers replaced.
