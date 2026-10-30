---
name: closeout
description: Run the pre-compact closeout - capture corrections, run the pre-compact scan, batch the tracking files, verify git, and write the continuation handoff. Use when the owner says "begin pre-compact", before a compact or a session end, or when a handoff for the next session is needed. Serves rule:pre-compact-scan.
---

# Closeout

Serves rule:pre-compact-scan and the ritual in rule:compact-ritual, which lists the closeout's five parts. The
next session starts from what this writes down, so every line must be true when it is written.

## Steps

1. **Capture** every style, format or workflow correction from this session where it lasts (rule:compact-ritual).
2. **Run the scan** below, step by step, each shown pass or fail. Its temp-file step covers shared and uploaded
   copies too (a project library, an attachment folder), not only the scratch folder.
3. **Batch the tracking files** at the session end (rule:tracking-file-batching).
4. **Verify git:** branch, HEAD, clean, ahead or behind, local and remote branches, finished agent worktrees
   removed (rule:compact-ritual, part 4).
   Where the repo has a sweep approval log, run `approve.mjs --summary` (pre-pr-sweep skill): a paused state goes
   into the handoff's State Snapshot as "auto-approval: paused since <date>, <reason>; the owner resumes with
   <command>", in every handoff until the owner resumes it.
5. **Write the handoff** in the shape below, run `node <this skill's folder>/audit.mjs <handoff.md> --send`, and fix
   every fault. In a project with several sessions, send the full text it prints as ONE message to the coordinating
   session, never a file path (the next session may not be able to read it). The channel by host: in a Claude
   project thread, `send_message` to `@parent`; elsewhere, the one the project names. The closeout is done only
   when the coordinator confirms it received the text; then close the thread.

## The scan

Run every step of rule:pre-compact-scan (the project's tracking-and-handoff rules), each shown pass or fail.

## The handoff

Write it in the shape rule:handoff-message-structure gives: one self-contained message, any command the owner
must run first in its own code block, then one copyable text block with its fixed sections.

## The audit

`audit.mjs` checks the handoff: every section of the rule's shape, in order; the first-actions section names the
orientation protocol; the Git line and the Next Step are filled in; ASCII only. It cannot check that the state
is true; the scan and the git verify do. With `--send`, a clean audit also prints the exact text to send to the coordinating session.

## Examples

- [examples/handoff-a.md](examples/handoff-a.md) and [examples/handoff-b.md](examples/handoff-b.md) - two
  handoffs written at a closeout, adapted from real ones with the product, names and numbers replaced.
