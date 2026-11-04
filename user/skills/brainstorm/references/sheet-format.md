# The Question Sheet

A plain markdown file, `<date>-<topic>.sheet.md`, that any person or model can read and fill in. No tool is needed to
answer it: tick a box, or write under a label. `sheet.mjs` reads it, and refuses what it cannot read rather than lose
words, so keep this layout exactly.

```markdown
# Sheet: <title>

id: <short-id>
asked by: <who wrote the questions, for example Claude>

## Grounding

<what this is, why it is in front of the owner now, and what raised it: a read of 60 seconds, plain words>

## Topic: <name>

### Q1. <the question>

Why it matters: <one line>

Options:
- [ ] a: <label>
- [ ] b: <label>

Pick: b
Why this pick: <one line>

Your answer:

What I thought:

## Anything I did not ask?

```

## Rules

- Questions number from Q1 across the whole sheet, in order, and every question sits under a topic.
- `Why it matters:`, `Options:` and `Pick:` may be left out of an open question. `Your answer:` and `What I thought:` never
  are. Leaving out the pick on a few questions gives answers no suggestion anchored.
- To answer: tick one box with `[x]`, or write under `Your answer:`, or both. A thought alone is not an answer.
- Under `Your answer:`, `What I thought:` and `Anything I did not ask?` the owner may write anything, in as many lines as
  they like, except a line that looks like the sheet's own structure: a `#` heading, or a field label on its own line.
  The parser stops on those and says which question, so nothing is cut short in silence.
- `sent:` is added under `asked by:` by the page export. A file sheet needs none.

## Checking

`node sheet.mjs check <sheet>` exits 0 when every question has a tick or an own answer, and names the ones that do not.
