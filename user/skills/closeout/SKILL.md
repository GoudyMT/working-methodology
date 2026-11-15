---
name: closeout
description: Run the pre-compact closeout - capture corrections, run the pre-compact scan, batch the tracking files, verify git, and write the continuation handoff. Use when the owner says "begin pre-compact", when the compact ritual starts it on its own, before a compact or a session end, or when a handoff for the next session is needed. Serves rule:pre-compact-scan.
---

# Closeout

Serves rule:pre-compact-scan and the ritual in rule:compact-ritual, which lists the closeout's five parts. The
next session starts from what this writes down, so every line must be true when it is written.

It starts on its own only as rule:compact-ritual says.

## Steps

1. **Capture** every style, format or workflow correction from this session where it lasts (rule:compact-ritual).
2. **Run the scan** below, step by step, each shown pass or fail. Its temp-file step deletes only inside the
   session's folder and lists anything else it made for the owner. Probe folders the thread made with
   `node <kit>/scripts/kit.mjs scratch new <thread> <label>` go with `scratch clean <thread>`, no ask: each to the
   bin with its guard record; one marked `scratch keep <folder> "<why>"` stays and is named; strays are listed.
3. **Batch the tracking files** at the session end (rule:tracking-file-batching). The next action, what blocks on
   the owner, what only waits for the owner's eyes, the carry-overs, the phase, the kit version and the last session
   are data: change them with `node .claude/state.mjs set | add | done`, one command per call. Record each owner
   decision with `state.mjs decide --from <file.json>`: its words are the owner's exact words from this session,
   and words not found there go in only with `--unchecked`, marked so. Then run `state.mjs render` and
   `state.mjs check` until it passes. Never edit a generated block by hand: render refuses a block edited since the
   last render, and only `render --overwrite`, after the change is in the data, writes over it. A project with no
   generated block yet runs `state.mjs init` once. Where the project keeps its improvement list as data
   (`_List.jsonl`), each row the session moved changes with `state.mjs item set <id> <field> <value>`: a row tagged
   done or closed names who caught it (`caught-by`) and whether it escaped a gate (`escaped yes`), and a row with a
   number names where it was measured (`measured`); roadmap steps change with `state.mjs step set`. The handoff
   carries the two lines of `state.mjs list caught` (catch rate, and found to shipped by origin). A markdown list is
   moved once with `state.mjs list import <file.md>`, which refuses any row it cannot move whole. `node .claude/tracking-check.mjs caps` prints the
   whole-file rows of the size-cap table; an OVER row is fixed before the handoff. The plan's Progress block passes
   `node .claude/tracking-check.mjs progress <plan>`. Where the project keeps
   `.kit/project-map.json`, update its progress from the plan, run `node .claude/project-map.mjs check` until it
   passes, then `render` the page and republish it to the same link (rule:diagrams).
4. **Verify git:** branch, HEAD, clean, ahead or behind, local and remote branches, finished agent worktrees
   removed (rule:compact-ritual, part 4).
   A closeout after a release runs `node .claude/release-check.mjs <tag> --pr <n>` (the kit adds `--copy` and
   `--installed`) until it prints RELEASE COMPLETE. Each MISSING line is a step not done: do it, or name it in the
   handoff as not done. The release is never called done, shipped or verified while a step is missing.
   Where the repo has a sweep approval log, run `approve.mjs --summary` (pre-pr-sweep skill): a paused state goes
   into the handoff's State Snapshot as "auto-approval: paused since <date>, <reason>; the owner resumes with
   <command>", in every handoff until the owner resumes it. A "carried open" above 0 means findings still sit in the
   handoff's "Carry-overs from the last PR": add each with `state.mjs add carry`, then render again.
5. **Write the resume packet:** `node .claude/resume-packet.mjs write` after the batch, so its hashes are of the final
   files; the next session starts from `check`. A line starting "fix before the next session" names a label or file
   name the check cannot read: fix that line in the tracking file and write again.
6. **Write the handoff** in the shape below, run `node <this skill's folder>/audit.mjs <handoff.md> --send`, and fix
   every fault. In a project with several sessions, send the full text it prints as ONE message to the coordinating
   session, never a file path (the next session may not be able to read it). The channel by host: in a Claude
   project thread, `send_message` to `@parent`; elsewhere, the one the project names. The closeout is done only
   when the coordinator confirms it received the text; then close the thread. The text ends with the next item from
   `node .claude/state.mjs show`, so the coordinator can open the next thread for it at once.

## The scan

Run every step of rule:pre-compact-scan (the project's tracking-and-handoff rules), each shown pass or fail.

## The handoff

Write it in the shape rule:handoff-message-structure gives: one self-contained message, any command the owner
must run first in its own code block, then one copyable text block with its fixed sections.

It carries the self-audit count (rule:pre-compact-scan 5c) as one line, `Feature builds since the last self-audit: <n>
(last: <version>)`, read from the last handoff and raised by one when this closeout ends a feature-focus build. At 10,
the handoff's first action is the self-audit; the method is the project's own (for the kit: the token audit method the
workbench keeps), and a project with none says so in that line.

## The audit

`audit.mjs` checks the handoff: every section of the rule's shape, in order; the first-actions section names the
orientation protocol; the Git line and the Next Step are filled in; ASCII only. It cannot check that the state
is true; the scan and the git verify do. With `--send`, a clean audit also prints the exact text to send to the coordinating session.

## Examples

- [examples/handoff-a.md](examples/handoff-a.md) and [examples/handoff-b.md](examples/handoff-b.md) - two
  handoffs written at a closeout, adapted from real ones with the product, names and numbers replaced.
