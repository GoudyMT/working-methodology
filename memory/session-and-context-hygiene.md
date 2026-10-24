---
name: session-and-context-hygiene
description: Read at session start, after a compact, before a compact, and when keeping tracking files and plans current.
metadata:
  type: feedback
---

**Governance is plain markdown**: a standards file (how), tracking files with one job each (dashboard, next action, roadmap checkboxes, narrative log), templates, and a memory folder with an index. Depth lives in specs, decisions and plans; tracking files hold a short summary plus a pointer, never a restatement.

**Post-compact orientation is not optional.** On the first turn after a compact or in a new session, freshly read every file in the reading order and show a visible checklist, before asserting any state or acting - even when the handoff says "shipped, nothing in flight". "I just re-read" is forbidden unless the read actually happened.

**Compact after each completed large step into new territory** (a shipped PR, a finished feature), not at the context limit. Why: output quality and rule adherence erode as context grows; a fresh orientation reloads the guardrails. Do not compact for rework of the current step.

**Pre-compact closeout, in order:**
1. Capture every correction the owner gave this session, durably.
2. Hygiene scans - forbidden characters, comment labels in touched files, duplication, size caps - each shown passing. A check not shown did not happen.
3. Update the tracking files to verified state.
4. Git verify: branch, HEAD, clean tree, ahead/behind; list local and remote branches and retire merged ones; remove finished agent worktrees.
5. A handoff message in one copyable text block (any command first, in its own block), with a "Next step" section: what, why, and where that comes from in the plan.

**The plan file is the progress record.** Short fresh windows mean chat is not the handoff. Keep a Progress block at the plan's top: current task, done with evidence, next, branch, open questions. Tick a box only against shown evidence. Record the measurement, not just the verdict. Write down what would make a done task not done.

**Ask instead of assuming**, hardest across windows, where a wrong assumption is invisible to the next session.

**Keep ledgers lean**: a status line carries counts and state, not a blow-by-blow.

**Codify a standard where it is read at session start** so it applies without reminders. Append a new correction the same session.

**Temporary files do not outlive their job.** Delete scratch scripts, screenshots and drafts once served.

Related: [[autonomous-loop-mode]], [[verification-and-evidence]].
