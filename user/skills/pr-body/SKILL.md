---
name: pr-body
description: Write a pull request body in the project's Standard or Lean format, audit it, and show it to the owner before any push or PR command. Use whenever a pull request is about to be opened or its body edited, or the owner asks for a PR body or PR description. Serves rule:pr-body.
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
3. **Draft** from the template, following the rule below.
4. **Audit:** `node .claude/pr-body-audit.mjs <body.md> "<title>"` (Lean: `.claude/pr-body-audit-lean.mjs`).
   Fix every failure; then reread for flow.
5. **Hand off** the rendered body and the audit result to the owner, naming the sources you read. Nothing is
   pushed and no PR is opened until the owner says go (rule:outward-acts).

## The rule

Read rule:pr-body in full first (the project's git-and-release rules): its hard rules, the Lean and Standard
shapes, summary not tallies, and never inflating a small PR. This skill adds the steps, the examples and the
audit; it never restates the rule.

## Examples

- [examples/standard.md](examples/standard.md) - a Standard body for a feature PR.
- [examples/lean.md](examples/lean.md) - a Lean body for a small PR.

Both are adapted from real PRs, with the product, names and numbers replaced. Match their conventions, not
their content.
