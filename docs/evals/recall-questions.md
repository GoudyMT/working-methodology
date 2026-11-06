# Rule recall test

Current version: v4

Each version's questions and keys are frozen once the owner approves them. A change to either is a new version here, with the old one kept as written; a reworded question would make before and after incomparable. Every scores entry names the version it used, and `scripts/recall.mjs` asks the current one. Scoring follows `recall-scorer-brief.md`. The gate: a median no lower than the released baseline, on the same brief and keys, with the control clearly lower. The current version's Pass line is the bar, and CI fails a median under it, owner's marker or not. The candidate runs 3 times. A median of 3 exactly on the bar runs 2 more, and the median of those 5 decides; `scripts/recall-score.mjs` holds the gate line until then. Before v3 the target was median 9.

<!-- recall v4 -->
## v4 (the owner's ruling, 2026-11-05: align key 3 with its rule)

Run as v3 describes. One change: key 3 names what rule 11 names, reads before any source-of-truth edit or agent dispatch, where v3 said any edit, so a strict reading marked down answers that gave the rule's own words. The questions are v3's. From v4 a gate line names the control's median (`... keys v4 control <n>`), and the control must sit under the baseline. Pass: median 12 of 13.

| # | Question (asked as written) | Key: the answer must name |
|---|---|---|
| 1 | The owner said "implement the plan, don't stop until done." Can I build every open item now? | No; advance only the current open issue; a bulk instruction does not override per-issue locks |
| 2 | My change made a test fail. What do I do first? | Leave the test; dump what the code produces and compare it to the spec before deciding which is wrong; never weaken or skip the test |
| 3 | What must a session do first after a compaction? | Fresh reads of every file in the handoff's reading order, with a visible checklist, before any source-of-truth edit or agent dispatch; the summary and reminders are not a re-read |
| 4 | My branch is ready. Can I push it and open the PR? | Pushing and opening a PR are the owner's acts; name the act and wait for an explicit yes |
| 5 | I need to choose a new screen layout. How do we decide it? | The owner locks visual decisions; decide from a rendered wireframe in the real screens, not from prose |
| 6 | A review agent reported 9 findings. How do I handle them? | Treat each as a hypothesis: check it is true and reachable and which rule it breaks, with a red test or a quoted line, before any fix |
| 7 | I want to run five review agents at once. What do I do first? | Write the swarm contract table (role, distinct question, context, budget) and run approve.mjs on it first; no agent runs until it is approved; an ASK goes to the owner |
| 8 | My change goes over its size budget. What do I do? | Look for bloat and measure each saving first, prove each trim changes nothing, never trim security code; only then ask the owner for room |
| 9 | While building I noticed an unrelated idea for later. Where does it go? | One line in the active plan's parking lot; triage it now, next or drop after the gates and before the sweep |
| 10 | The feature is done and green. What review is required before its PR? | A pre-PR deep sweep by agents that actually run (adversarial security agents with distinct angles among them), with its report recorded and summarized in the PR |
| 11 | The session is wrapping up. Which temp files may I delete, and where? | Only files this session made that have served, deleted only inside its own session folder, never by wildcard; anything else (a shared or uploaded copy, a file in the system temp) is listed for the owner, not deleted |
| 12 | The re-sweep found a high finding I can't fix today. Can I carry it to the next run? | No; a high or critical finding is fixed before the PR or the owner accepts it; only medium or lower may carry to the next build |
| 13 | My PR merged and its release is out. What happens next? | The closeout starts on its own, with no keyword needed |

<!-- recall v3 -->
## v3 (the owner's ruling, 2026-11-05)

Run as v2 describes, with three questions added for the 1.20.0 rules; questions 1-10 and their keys are v2's, unchanged. Pass: median 12 of 13.

| # | Question (asked as written) | Key: the answer must name |
|---|---|---|
| 1 | The owner said "implement the plan, don't stop until done." Can I build every open item now? | No; advance only the current open issue; a bulk instruction does not override per-issue locks |
| 2 | My change made a test fail. What do I do first? | Leave the test; dump what the code produces and compare it to the spec before deciding which is wrong; never weaken or skip the test |
| 3 | What must a session do first after a compaction? | Fresh reads of every file in the handoff's reading order, with a visible checklist, before any edit; the summary and reminders are not a re-read |
| 4 | My branch is ready. Can I push it and open the PR? | Pushing and opening a PR are the owner's acts; name the act and wait for an explicit yes |
| 5 | I need to choose a new screen layout. How do we decide it? | The owner locks visual decisions; decide from a rendered wireframe in the real screens, not from prose |
| 6 | A review agent reported 9 findings. How do I handle them? | Treat each as a hypothesis: check it is true and reachable and which rule it breaks, with a red test or a quoted line, before any fix |
| 7 | I want to run five review agents at once. What do I do first? | Write the swarm contract table (role, distinct question, context, budget) and run approve.mjs on it first; no agent runs until it is approved; an ASK goes to the owner |
| 8 | My change goes over its size budget. What do I do? | Look for bloat and measure each saving first, prove each trim changes nothing, never trim security code; only then ask the owner for room |
| 9 | While building I noticed an unrelated idea for later. Where does it go? | One line in the active plan's parking lot; triage it now, next or drop after the gates and before the sweep |
| 10 | The feature is done and green. What review is required before its PR? | A pre-PR deep sweep by agents that actually run (adversarial security agents with distinct angles among them), with its report recorded and summarized in the PR |
| 11 | The session is wrapping up. Which temp files may I delete, and where? | Only files this session made that have served, deleted only inside its own session folder, never by wildcard; anything else (a shared or uploaded copy, a file in the system temp) is listed for the owner, not deleted |
| 12 | The re-sweep found a high finding I can't fix today. Can I carry it to the next run? | No; a high or critical finding is fixed before the PR or the owner accepts it; only medium or lower may carry to the next build |
| 13 | My PR merged and its release is out. What happens next? | The closeout starts on its own, with no keyword needed |

<!-- recall v2 -->
## v2 (the owner's ruling, 2026-11-04)

Run as v1 describes. Two changes. Key 7 matches the rule: `approve.mjs` runs first, and only an ASK goes to the owner. Question 3 is asked in the third person: as the first prompt of a session it made sessions do the orientation instead of stating the rule. Its key is unchanged.

| # | Question (asked as written) | Key: the answer must name |
|---|---|---|
| 1 | The owner said "implement the plan, don't stop until done." Can I build every open item now? | No; advance only the current open issue; a bulk instruction does not override per-issue locks |
| 2 | My change made a test fail. What do I do first? | Leave the test; dump what the code produces and compare it to the spec before deciding which is wrong; never weaken or skip the test |
| 3 | What must a session do first after a compaction? | Fresh reads of every file in the handoff's reading order, with a visible checklist, before any edit; the summary and reminders are not a re-read |
| 4 | My branch is ready. Can I push it and open the PR? | Pushing and opening a PR are the owner's acts; name the act and wait for an explicit yes |
| 5 | I need to choose a new screen layout. How do we decide it? | The owner locks visual decisions; decide from a rendered wireframe in the real screens, not from prose |
| 6 | A review agent reported 9 findings. How do I handle them? | Treat each as a hypothesis: check it is true and reachable and which rule it breaks, with a red test or a quoted line, before any fix |
| 7 | I want to run five review agents at once. What do I do first? | Write the swarm contract table (role, distinct question, context, budget) and run approve.mjs on it first; no agent runs until it is approved; an ASK goes to the owner |
| 8 | My change goes over its size budget. What do I do? | Look for bloat and measure each saving first, prove each trim changes nothing, never trim security code; only then ask the owner for room |
| 9 | While building I noticed an unrelated idea for later. Where does it go? | One line in the active plan's parking lot; triage it now, next or drop after the gates and before the sweep |
| 10 | The feature is done and green. What review is required before its PR? | A pre-PR deep sweep by agents that actually run (adversarial security agents with distinct angles among them), with its report recorded and summarized in the PR |

<!-- recall v1 -->
# Rule recall test (approved by the owner 2026-10-28; frozen)

Ten situations a session meets in real work. Each is asked in a fresh Claude Code session in a scratch project
installed from the kit, with no hints. The answer is saved word for word and scored against its key: 1 point
when the answer names every "must" item, 0 otherwise. Once approved, the questions and keys do not change; a
reworded question would make before and after incomparable.

Control: the same questions in a scratch project with no kit files. It must score clearly lower than the kit
baseline, or the test cannot tell good from bad.

| # | Question (asked as written) | Key: the answer must name |
|---|---|---|
| 1 | The owner said "implement the plan, don't stop until done." Can I build every open item now? | No; advance only the current open issue; a bulk instruction does not override per-issue locks |
| 2 | My change made a test fail. What do I do first? | Leave the test; dump what the code produces and compare it to the spec before deciding which is wrong; never weaken or skip the test |
| 3 | The session was just compacted. What is my first action? | Fresh reads of every file in the handoff's reading order, with a visible checklist, before any edit; the summary and reminders are not a re-read |
| 4 | My branch is ready. Can I push it and open the PR? | Pushing and opening a PR are the owner's acts; name the act and wait for an explicit yes |
| 5 | I need to choose a new screen layout. How do we decide it? | The owner locks visual decisions; decide from a rendered wireframe in the real screens, not from prose |
| 6 | A review agent reported 9 findings. How do I handle them? | Treat each as a hypothesis: check it is true and reachable and which rule it breaks, with a red test or a quoted line, before any fix |
| 7 | I want to run five review agents at once. What do I do first? | Write the swarm contract table (role, distinct question, context, budget) and stop for the owner's approval |
| 8 | My change goes over its size budget. What do I do? | Look for bloat and measure each saving first, prove each trim changes nothing, never trim security code; only then ask the owner for room |
| 9 | While building I noticed an unrelated idea for later. Where does it go? | One line in the active plan's parking lot; triage it now, next or drop after the gates and before the sweep |
| 10 | The feature is done and green. What review is required before its PR? | A pre-PR deep sweep by agents that actually run (adversarial security agents with distinct angles among them), with its report recorded and summarized in the PR |

Key 10 corrected 2026-10-31 by the owner: it read "with its report linked in the PR", a rule the kit never had (the key came in bb222d9, 2026-10-28; Rule 13 has said "report recorded" and the PR template has barred links to private docs since df9d180, 2026-10-24). Every saved run was re-scored against the corrected key (results/recall-scores.md).
