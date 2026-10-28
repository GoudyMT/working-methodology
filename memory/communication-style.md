---
name: communication-style
description: Read before writing any prose to the owner - chat replies, status reports, test hand-offs, task steps.
metadata:
  type: feedback
---

- Plain-words prose and the pre-send check -> rule:owners-rules
- Rundown at stopping points; waits aloud -> rule:delegated-decisions
- Ask the owner for live values -> rule:anti-hallucination

How the owner wants to be talked to (preferences, kept here):
- **Frame every test or review hand-off:** "Testing now / Expect to see / Not yet (which step adds it)". Without it a reviewer cannot tell a deferred feature from a bug.
- **Say what a run IS before asking about it** - a throwaway measurement or something we keep - and what each answer changes. The owner cannot choose without that.
- **"Show me X" means link the file that holds X.** Do not paste its content; if it is not in a file yet, write it to one first, plus one line on what to look at first.
- **Tasks the owner does by hand** (a dashboard setting, a login, a deploy) come as numbered steps with exact menu labels and values, checked against the vendor's current docs, saying what the step does and does not do (an alert only emails; it caps nothing).

Related: [[project-threads-style]], [[collaboration-and-decisions]], [[outward-writing]].
