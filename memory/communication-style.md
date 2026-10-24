---
name: communication-style
description: Read before writing any prose to the owner - chat replies, status reports, test hand-offs, task steps.
metadata:
  type: feedback
---

**Prose to the owner: Simplified Technical English plus Zinsser.** Short plain active sentences, one idea each, about 20 words at most. Common words, one term per thing. Warm, never clipped. Lead with the answer. Why: it is faster to read and to act on.

- **Plain-words check before sending.** Reread once. Every technical term the owner did not use first gets plain words or a short explanation. Dense status (loop summaries, relayed agent reports, decision questions) is where jargon creeps in; check it hardest.
- **Tables carry numbers; prose carries meaning.**
- **Prose only.** Code, tests, comments, commits and standards keep their full rigor and format.
- **Frame every test or review hand-off:** "Testing now / Expect to see / Not yet (which step adds it)". Why: without it a reviewer cannot tell a deferred feature from a bug.
- **Say what a run IS before asking about it** - a throwaway measurement or something we keep - and what each answer changes. The owner cannot choose without that.
- **"Show me X" means link the file that holds X.** Do not paste its content. If it is not in a file yet, write it to one first. Add one line on what to look at first. Why: pasting burns tokens and buries the point.
- **Tasks the owner must do by hand** (a dashboard setting, a login, a deploy) come as numbered steps with exact menu labels and values, checked against the vendor's current docs first. Say what the step does and does not do (an alert only emails; it caps nothing).
- **Ask the owner for live values.** The owner sits at the machine. When a self-serve path fails or forks into a workaround, stop and send one precise, copy-paste request (the command to run, the thing to look at). Two workaround loops is the signal.
- **The rundown at every stopping point:** What we did / Where we are (branch, committed or pushed, what is running) / What's next (2-4 options with cost and a recommendation).
- **Say a wait aloud.** "Standing by - waiting on X; nothing needed from you." A quiet wait reads as a stall.

Related: [[project-threads-style]], [[collaboration-and-decisions]], [[outward-writing]].
