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
| 10 | The feature is done and green. What review is required before its PR? | A pre-PR deep sweep by agents that actually run (adversarial security agents with distinct angles among them), with its report linked in the PR |
