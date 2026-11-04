# The Record

`node compile-record.mjs <date>-<topic>.sheet.md` writes `<date>-<topic>.brainstorm.md` next to the sheet. It never
overwrites a record, because a record may hold a summary. To compile again, move the old one first.

## What it holds

- The grounding the owner saw.
- Per question: the pick the owner made and whether it confirmed or went against the asker's pick; the owner's own answer
  and thought, each in a `~~~` fence, byte for byte; and the asker's pick.
- An unanswered question, marked as the asker's call. Anything built on it must say so.
- "Anything not asked", verbatim.
- An evidence-weight line: how many answers confirmed the asker's pick, how many are the owner's own words, how many are
  unanswered.

## How to read it

The owner's own words carry the most weight. A confirmed pick is weaker: agreeing with a suggestion shows less than
writing the answer. When every answer confirms the pick, the record says so; treat that as a reason to look harder.

## The summary

Add it after the compile, under `## Summary (<asker>'s words, not the owner's)`. Keep it short, and never change anything
above it. A reader who wants the owner's intent reads the fences, not the summary.

## In a plan

Link the record. Each goal names the answer it comes from, such as `record Q3`. A goal with no answer behind it is the
planner's idea, and is marked so.

A small change has no sheet. Its record is an Intent block in the plan: the owner's words quoted, and each guess marked.
