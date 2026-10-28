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

- **Hard rules (outward-facing):** ASCII; no AI / agent / tool references (reviews described BY DIMENSION + verdict); no links to gitignored vault docs; value-led title `<Area>: <line>`, H1 = the title.
- **Lean:** 1-2 sentence framing, <= 3 changes (what and why, no file lists), 3 gates (the proof; the full gate as one line; the sweep exemption by dimension), <= 1 sentence of notes.
- **Summary, not tallies:** outward summaries state the end result, and each thing once. No per-step tallies (size raises, finding, test or mutant counts); keep a number only if it is the result or the reader acts on it. Test each line: who reads it, and why care? Detail stays in the sweep report and plan. Why: tallies bury the result.
- **Standard:** before / after table; decisions and review result on screen; file list, gate results and clean checks in folds; total, on-screen and per-bullet ceilings ("wall of text" = on-screen words and bullet length); plain engineer speak.
- **Never inflate a small PR.** The audit script (sections, width, word caps, banned words, ASCII) runs with every body; it cannot see content drift, so keep the conventions of the lived bodies (below; a budget raise states the final old -> new and its basis; a proof gate claims only what ran). Body + audit go to the owner BEFORE any push or PR command. After a trim, reread for flow.

## Examples

- [examples/standard.md](examples/standard.md) - a Standard body for a feature PR.
- [examples/lean.md](examples/lean.md) - a Lean body for a small PR.

Both are adapted from real PRs, with the product, names and numbers replaced. Match their conventions, not
their content.
