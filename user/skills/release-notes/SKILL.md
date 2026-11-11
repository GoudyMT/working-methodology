---
name: release-notes
description: Draft the release notes that follow a merge that changes what users get, sized by semver, audited claim by claim, and published only on the owner's yes. Use after a user-facing merge, when the owner asks for a release, a changelog entry or release notes, or before creating a git tag for a release. Serves rule:release-notes.
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
   and audit each claim to the file, test or measurement that proves it. The changelog entry follows
   `_Templates/_Changelog Entry Template.md`: grouped one-line changes, the detail left in the PR body.
5. **Hand off** the draft, its audit result and the sources to the owner. Create the tag and publish only on
   the owner's explicit go (rule:outward-acts); after publishing, read the live body back and diff it.

## The rule

Read rule:release-notes in full first (the project's git-and-release rules): matching the latest release of the
same kind, leading with value, semver, public prose, the owner's publish, the version bump, and the tag. This
skill adds the steps, the examples and the audit; it never restates the rule.

## The audit

`audit.mjs` checks what a script can see: ASCII only, dash-free (no em dash, no double hyphen), no AI or tool
words, no links into gitignored notes, no tooling or test tallies, and that the version given matches the
`version` in `package.json` when one exists. It cannot check that a claim is true; that audit is yours.

## Examples

- [examples/feature.md](examples/feature.md) - a feature release (minor).
- [examples/quality.md](examples/quality.md) - a quality release (patch).

Both are adapted from real releases, with the product, names and numbers replaced.
