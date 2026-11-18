---
name: pr-body
description: Write a pull request body in the project's Standard or Lean format, audit it before the PR command, and give it to the owner after. Use whenever a pull request is about to be opened or its body edited, or the owner asks for a PR body or PR description. Serves rule:pr-body.
---

# PR Body

Serves rule:pr-body. The project's adapter row A16 sets the ceilings and the audit commands; the project's
template and audit scripts win over anything here.

## Steps

1. **Read the sources first** (rule:pr-body, "Every outward piece starts from its format"): the project's
   `_Templates/_PR Body Template.md`, the two latest merged PR bodies of the same size
   (`gh pr list --state merged --limit 6`, then `gh pr view <n> --json title,body`), and the examples below.
2. **Pick the format by stakes:** Standard for a feature, sub-project or any PR with design decisions or new
   behaviour; Lean for a chore, docs, config, a bump or a one-line change that does not change behaviour. When
   unsure, Standard.
3. **Draft** from the template, following the rule below. The Review section carries the sweep's summary from
   its report: the commit it covered, the result per dimension, each high or critical finding and how it was
   handled, deferred items with where they are tracked, accepted risks, and the verdict. Never link the report
   or any private file; an unfixed security finding gets its severity and tracker, never its detail.
   **Measured tokens, the file sizes behind them, or a measured wait moved:** run
   `node .claude/visuals.mjs <base> <head> --body <body.md>` (`--fold` while the audits in force predate the
   section). It reads `.kit/visuals.json` (its shape is in the script's header: each metric names its impact, cost,
   time or room, and a typed number the two commits it was measured at), keeps what moved, writes the section with
   the outcome first, and leaves one `<why>` per row: replace each with what moved it and why. Commit the chart it
   draws and run it again to link the image. Nothing moved: no section. Never tallies; a Lean body puts its number
   in the gate line.
4. **Audit:** `node .claude/pr-body-audit.mjs <body.md> "<title>" [<PR number>]` (Lean: `.claude/pr-body-audit-lean.mjs`); with no number it keeps 8 characters for the " (#n)" suffix.
   Fix every failure; then reread for flow.
5. **Open and hand off:** a PR from a feature branch opens with no yes (rule:outward-acts); then give the owner the
   PR link, the audit result and the sources you read. Editing a merged PR's body or a release is still the owner's.
6. **Report CI unasked:** after each push to the PR, start `node .claude/ci-wait.mjs <pushed commit>` in the
   background and pass each line it prints on to the owner as it comes: one line as each run ends, green or red,
   one once a run passes ten minutes, and the result.

## The rule

Read rule:pr-body in full first (the project's git-and-release rules): its hard rules, the Lean and Standard
shapes, summary not tallies, and never inflating a small PR. This skill adds the steps, the examples and the
audit; it never restates the rule.

## Examples

- [examples/standard.md](examples/standard.md) - a Standard body for a feature PR.
- [examples/lean.md](examples/lean.md) - a Lean body for a small PR.

Both are adapted from real PRs, with the product, names and numbers replaced. Match their conventions, not
their content.
