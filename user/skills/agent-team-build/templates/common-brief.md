# Common brief - <project>, orchestrated mode

Read this in full, then the project brief (its path is in your brief), then your own brief. Together
they are your whole world: you do not have the overseer's conversation.

## 1. Rules for every brief you write

- Every builder and checker brief opens with the "Project rules" read instruction from the templates: the agent
  reads the rules block from the project's standards file itself. Never paste or summarize the block.
- Add to every brief as well: never `cd` into a subfolder (absolute paths, `git -C`); never type an escape sequence
  into a tool parameter or a script (build characters with `String.fromCharCode`; a filter that needs a quote or a
  pattern goes in a small script file or the Grep tool); web tools are WebSearch and WebFetch on HTML pages only -
  never a .pdf/.docx/.pptx link, never curl or Invoke-WebRequest, never the browser pane; no downloads without the
  user's yes; never kill a process you did not start; run every project tool from the agent's own folder (the
  project brief gives the form), never by a bare path from the main checkout.
- Read-only GitHub is allowed (viewing pull requests, runs and their logs). Anything that writes to GitHub is the
  overseer's.

## 2. The shared machine

Follow `orchestrated.md`, "The shared machine". Your port range is in your brief; the lock's literal path and the
commands are in the project brief.

## 3. Phase 1 (planning) - what you deliver, then STOP

- The plan file your brief names: the batch-plan template, with its Team section and a Parking Lot section (one line
  per out-of-scope idea, routed before the review).
- Design artifacts where your brief allows them, drawn from the code's own output (real titles, dates and states),
  never from a tidy sample.
- The Phase 1 report in your role's format. Put every question for the user in it, each with options and your
  recommendation: they are answered together at approval.

## 4. Phase 2 milestones (report at each)

1. Every unit integrated on your branch, checked as `SKILL.md` "The flow" steps 4 and 5 say (the per-unit check or
   the re-run break check; the size checks during integration).
2. The full gate green on the branch head.
3. Before the review: the ONE review wave you propose as a Swarm Contract (what it holds: `SKILL.md` "The flow",
   step 6), sent to the overseer, who checks it and takes it to the user (`orchestrated.md`, "Sweeps go through the
   overseer").
4. The review's report to the overseer (who checks it and delivers it); the findings through the project's finding
   pipeline; the fixes; the fix check and the re-sweep as `SKILL.md` "The flow" step 6 says (the re-sweep's contract
   approved the same way); the gate green again.
5. User-facing work: the project's pre-push use-and-attack test, where the project has one.
6. Ready to push: the facts the pull request body needs (the overseer writes the body with the user).

Each phase is led by a fresh orchestrator (`orchestrated.md`, "A fresh lead per phase"), and the overseer sets each
phase's pause line (`orchestrated.md`, "The kill-switch"). Record every agent you start: role, model, job, whether
you used its output; the overseer measures real spend from the run records (`SKILL.md`, "Cost").

## 5. Measuring

- Estimate in dollars; the overseer measures as `SKILL.md` "Cost" says.
- Record every machine-lock hold (start, end, what) in your plan's Progress: the overseer reads the serial share of
  the work from it.

## 6. Downloads resolve first

Any dependency change pins exact versions, then resolves without downloading (a lockfile-only install), then compares
the lockfile with the approved list, and installs ONLY if it matches. A version range is not a version, and a list
copied from an older lockfile goes stale within days. A check that runs after the act it protects is a report, not a
guard.
