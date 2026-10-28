# Loop Learnings - <PROJECT NAME>

> Lessons from **Loop Workflow Mode** and Agent-Team builds (see rule:loop-workflow-mode). Capture ONLY behaviour-changing lessons - a correction the owner made, a plan under-spec that forced a stop, a test / code anomaly + root cause, a near-miss on standards, a visual that looked wrong while tests passed. NOT routine green tasks or gate-stops that worked as designed. A recurrence = **REGRESSION** (hard stop + loud flag + scoreboard bump). Confirmed or recurring lessons graduate to rule:graduated-loop-lessons and move to `_Archive/_Loop Learnings Archive.md`. This file holds open lessons only.

---

## Scoreboard

One line per loop run (or per session with loops). The trend is the accuracy signal: corrections per loop falling, regressions = 0.

Format: `- <date>: <N> loop(s) - <scope> (<N> commits <first>..<last>), <N> halts (<what>), <N> corrections, <N> regressions (<which L-NN>), <new lessons>, <N> guards added (<which L-NN -> hook / test / lint>).`

A lesson that recurs once becomes a guard, not more text (rule:kit-standards #6); the entry's `Guard:` line names it.

-

---

## Agent-team scoreboard

One line per feature built under the Agent-Team Build (format in the `agent-team-build` skill). After 3 lines, review them with the owner and set the loosen / tighten rules from the data.

Format: `- <date> <feature> (builder <model>, checker <model>): units <N> | first-pass PASS <n>/<N> | FIX rounds <n> | escapes <n> (<where found>) | owner stops <n> (hard-stop <n>; avoidable <n>).`

-

---

## Trial scope

<What the loop may do in this project today - e.g. "may create files and build visuals only via a pre-agreed loop contract; visuals gated by the <=3-increment Visual Checkpoint". Widen only as the scoreboard proves it out.>

---

## Entry template

```
### L-NN | <short title> | open
- What happened: <1 line>
- Root cause:    <1 line>
- Rule (never/always): <1 line, actionable>
- Recurred: 0
- Guard: - (required once Recurred >= 1: the hook, test, lint rule or script that now catches it)
- Graduated to: -
```

---

## Open lessons

<!-- Newest first. Each entry uses the template above. -->

---

## Graduated -> rule:graduated-loop-lessons

General lessons already carried as standing rules in rule:graduated-loop-lessons (unless noted). A recurrence of any of these is still a REGRESSION.

- Find everything a change invalidates, repo-wide (source, tests, E2E, public docs), before the first edit -> #1
- A test must be able to fail: break the code and see red on an assertion, not a crash -> #2
- Never push escapes through a shell or a tool parameter; build non-ASCII at run time -> #3
- Anchor every edit on freshly read bytes -> #4
- Thrown errors carry static opaque codes, never interpolated input -> #5
- The tool shell's runtime needs its own command prefix -> rule:project-adapter A23 (#6)
- Never `cd` into a subfolder; the only `cd` is to the project root -> #7
- Stop the preview server before any rebuild; show unreachable states on a throwaway route -> #8
- A number or rule handed to an agent is computed or quoted (file:line) first -> rule:anti-hallucination
- A claim about how often something happens is measured before it is said -> rule:anti-hallucination
- Never chain a commit after a commit that failed -> rule:pre-commit
- A capped search is not an absence; a grep that finds your own new text is not verification -> rule:enumerate-before-you-count
- A walkthrough on a dev server blocks every route that reaches an outside service -> rule:security-standards
- A multi-file edit script does every read and check first, then all writes; back up first -> keep as a loop lesson until it recurs
- An agent's isolated worktree may start from `main`, not your branch: set the base and have builders report it -> Agent-Team adapter field 9
- A surviving mutation is dead only after its case was built and run, not argued -> rule:test-value
- Scope loop-worthiness BEFORE proposing a loop count -> rule:loop-workflow-mode
