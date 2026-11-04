---
name: brainstorm
description: Dig out what the owner expects before any plan, in a sized interview whose answers are kept word for word. Ask by chat for a small change, or by a question sheet for a major feature or a new project, then compile a record that later threads, agents and other models can work from. Use when the owner says brainstorm, asks what questions you have, or starts a feature or project whose intent is not yet written down.
---

# Brainstorm

Get what the owner means out of their head and onto a page, exactly, before anyone plans.

**The top rule: accuracy above cost.** Accuracy means capturing the owner's intent, relaying it, and executing as
expected. A sheet saves tokens over typing back and forth, and that is why it exists; a cheaper step that loses
accuracy is never taken.

Why: what the owner wants is usually thinner in our heads than it feels, and every unasked question becomes a guess
made without them.

## Size it first

Say the size in one plain line. The owner may override it.

| Size | How questions go | The record |
|---|---|---|
| Quick (everything that matters is in the request) | No brainstorm | None |
| Small (one or two open questions) | Chat or a decision card, never a sheet | A short Intent block in the plan, the owner's words quoted |
| Major feature (three or more open questions) | One sheet, one topic | A compiled record |
| New project | Sheets, up to three topics open at once | A compiled record per sheet |

The stop rule is coverage, not a count. Keep a ledger of unknowns; the brainstorm ends when every unknown is answered,
marked as yours to decide, or named as one only data can settle. If the work grows mid-way, step up a size and say so.

## Steps

1. **Read first.** Read what the project already records about the idea. A question the records answer is not asked.
2. **Build the unknowns ledger** from the ground in [references/question-craft.md](references/question-craft.md). A new
   project covers all of that ground. A feature covers what its size needs.
3. **Write the questions.** Fit them to this work; there is no fixed script. Each one carries why it matters, options
   where options are honest, your pick and why, and room for the owner's own answer and what they thought. Open with a
   grounding a reader takes in within 60 seconds: what this is, why it is in front of the owner now, and what raised it,
   in plain words. Close with "Anything I did not ask?". Before sending, run the pre-mortem and the "what did I not ask"
   check in the craft file.
4. **Send it.** Write the sheet file: `<record folder>/<date>-<topic>.sheet.md`, in the layout of
   [references/sheet-format.md](references/sheet-format.md). The default record folder is `docs/brainstorms/`. The file is
   the one truth; any person or model can fill it in. Then say where it is and stop.
5. **Wait for the owner.** They say "sent", or the page notifies you. Do not poll.
6. **Check and compile.** `node sheet.mjs check <sheet>`, then `node compile-record.mjs <sheet>`. A script does the copying
   so the owner's words are never retold. Format: [references/record-format.md](references/record-format.md).
7. **Close the gaps.** A new unknown from the answers gets a follow-up sheet or a chat question. An unanswered question is
   your call, marked as yours in everything built on it.
8. **Add a summary** under its own marked heading in the record, in your words, and say it is yours. Never edit what the
   script wrote.

## The optional page

Where the session can publish a page, `assets/sheet-page.html` shows a sheet with buttons and write-in boxes, which is
easier on a phone. It is only a view. Its Send button stays off until every question is answered, and it notifies the
watching session where that is possible; otherwise the owner says "sent". Before compiling, export its saved rows
with `node sheet.mjs export <rows folder> <id> <sheet.md>`, so the file stays the one truth.

## Using the record

Later work links the record and treats the owner's words as the source of intent. A plan's goals each name the answer
they come from. A confirmed pick is weaker evidence than the owner's own words: the owner may only have agreed with
what was in front of them, so weigh it that way.

## Red flags

| Thought | Reality |
|---|---|
| "One question at a time is friendlier" | For three or more, a sheet is one read and one answer. |
| "I know what they mean" | Then it is a guess. Mark it, and ask if it matters. |
| "I'll tidy their wording in the record" | The script copies it. Odd spelling stays. |
| "They confirmed every pick, so we agree" | Say so in the record; it is weak evidence. Ask one question with no pick. |
| "A sheet would be thorough" for a one-line change | Size first. A small change never opens a sheet. |

## In the methodology kit

This section is the kit's thin layer; the rest of this skill stands alone.

- The plan-feature skill hands its questions here for small work and up, then plans from the record. Each plan goal names
  the record answer it comes from.
- The record folder is the docs location in adapter row A22 when it names one, else `docs/brainstorms/`.
- The grounding follows the plain overview in rule:collaborative-design-locks; questions to the owner follow
  rule:owners-rules #8; an open question only data can settle follows rule:goal-before-mechanism.
- The record is the intent reference for later checks (E16) and for plan self-approval (E6).
