---
name: preview-test
description: Test a user-facing pull request on the host's deployed preview build before merge, on the devices its stakes call for, and record the result. Use before merging any user-facing PR, when a preview or version URL is ready, or when the owner asks for a preview test. Serves rule:preview-test.
---

# Preview Test

Serves rule:preview-test. The project's adapter rows A19 and A20 name the preview host and the owner's test
devices.

## Steps

1. **Get the preview link** for the branch's build; open it yourself first. Use made-up details only and send
   nothing (rule:preview-test: previews may hold live secrets).
2. **Make the stakes call** from the rule below: emulation only, or the owner's real device too, and why.
3. **Check in phone and desktop emulation:** the response headers and security policy, workers, and the layout
   of every changed surface, with screenshots.
4. **If the owner's device is called for,** hand the owner the link and a short list of what to try, and wait
   for their result.
5. **Write the record** (the shape below), run `node <this skill's folder>/audit.mjs <record.md>`, and give it
   to the owner with the shots. A FAIL goes through rule:finding-pipeline before merge.

## The rule

Read rule:preview-test in full first (the project's reviews-and-findings rules), above all who tests the preview
by stakes. This skill adds the steps, the record, the examples and the audit; it never restates the rule.

## The record

```markdown
## Preview test - <PR title>, #<number> (<date>)

- **Build:** the host's preview for `<branch>` at `<commit>`; the lead opened it first.
- **Who, by stakes:** the lead in emulation only | the lead AND the owner on <device> - <why, from the rule>
- **Setup:** phone emulation and desktop; made-up details only; nothing sent (<how sending was blocked>).

| Check | Result |
|---|---|
| Security headers; service worker | <same as production / what differs> |
| <each changed surface or flow> | <what happened> |

<the owner's part, in a second table, when the stakes call for it>

- **Shots:** <what was shot and where it was posted>
- **Result:** PASS | FAIL - <what goes to the finding pipeline>
- **Not covered here:** <what this test could not prove>
```

## The audit

`audit.mjs` checks the record's shape: the PR number in the title, the branch at its commit, who tested by
stakes, a setup with made-up details and nothing sent, a result for every check, the shots, and PASS or FAIL. It
cannot see the screen; the shots do.

## Examples

- [examples/emulation-only.md](examples/emulation-only.md) - a PR checked by the lead in emulation only.
- [examples/owner-device.md](examples/owner-device.md) - a PR the owner also tested on a real device.

Both are adapted from real preview tests, with the product, names and numbers replaced.
