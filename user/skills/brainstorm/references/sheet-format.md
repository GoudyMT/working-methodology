# The Question Sheet

A plain markdown file, `<date>-<topic>.sheet.md`, that any person or model can read and fill in. No tool is needed to
answer it: tick a box, or write under a label. `sheet.mjs` reads it, and refuses what it cannot read rather than lose
words, so keep this layout exactly. Save it as UTF-8.

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

Asker's pick: b
Why this pick: <one line>

Your answer:

What I thought:

## Anything I did not ask?

```

## Rules

- Questions number from Q1 across the whole sheet, in order, and every question sits under a topic.
- `Why it matters:`, `Options:` and `Asker's pick:` may be left out of an open question. `Your answer:` and `What I thought:` never
  are. Leaving out the pick on a few questions gives answers no suggestion anchored.
- To answer: tick one box with `[x]`, or write under `Your answer:`, or both. A thought alone is not an answer.
- Everything above `Your answer:` is the asker's, one line per field. A note written there has nowhere to go, so it is
  refused and the message says to move it.
- Under `Your answer:`, `What I thought:` and `Anything I did not ask?` the owner may write anything, in as many lines as
  they like, headings and labels included: they stay the owner's words. Only three lines end a box: `What I thought:`
  under an answer, and `### Q<next number>. `, `## Topic: ` or `## Anything I did not ask?` at the start of a line.
  A `## Topic: ` line typed in a thought starts a new topic, so keep that one out of an answer.
- `sent:` is added under `asked by:` by the page export. A file sheet needs none.

## Checking

`node sheet.mjs check <sheet>` exits 0 when every question has a tick or an own answer, and names the ones that do not.
