---
id: loop-mode
load: on-demand
when: When the owner turns loop mode on.
tags:
  loop-workflow-mode: loop, autonomous, keyword
  graduated-loop-lessons: lessons, learned, regression
---

# Loop Mode

## Loop Workflow Mode (Keyword-Gated TDD Loop) {#loop-workflow-mode}

An opt-in overlay for mechanical TDD work, under graduated trust; the default stays manual. Files and visuals only via a pre-agreed **loop contract**.

**Loop-First Scoping (mandatory).** At the start of every substantive task, state the verdict: the mechanical slices (test shape, implementation and commit message all pre-determined) vs the parts needing a choice or a human eye. Not looping is valid; not considering is a miss; never manufacture work to loop. **The bar never moves to fit the loop:** raise it or loop less. Why: the loop offloads grind; it must never buy speed with integrity.

**Self-Correction Boundary - self-correct mechanics, escalate choices.** Self-correct (log the lesson; ~2 attempts): an anchor miss, a typo or wrong import, an API differing from the guess (read the installed types), an under-tested implied branch. Hard stop and escalate even when a fix is reachable: a decision, name, format or style outside the plan; an integrity-LOWERING test change; an off-contract file or unverified visual; a 4th visual increment; a spec / ADR / public-interface change; an unexpected test result; non-convergence; a call for the owner's visual / legal eye; the end of the tasks or the goal. Why: "self-correct more" must never become silent drift.

**State machine.** OFF by default and after every compact. Armed only by the owner's exact phrase **"begin loop workflow"**, after a clean orientation, a learnings scan in Claude's report, an agreed contract (for files or visuals), and the owner's comfort. ANY owner message mid-loop halts it. Why: a persistent keyword outlives the context that justified it.

**Loop contract:** files to create (path, why, the reference it mirrors - any other file = hard stop); visual increments with their LOCKED reference; expected test collisions from a repo-wide search. Each run: a plan before, a LOOP SUMMARY after.

**Per task:** failing test -> shown FAILING for the right reason -> minimal code -> real counts, whole suite GREEN -> one-line `type: subject` commit -> next. Claude runs the test runner and local git; **push is never automated.** Why: a bad loop unwinds locally. **Command environment:** <!-- PROJECT ADAPTER A11: the tool-shell prefix that finds the right runtime with no installs. -->

**Visual-correctness gate.** Tests verify structure, never appearance. After at most **3 visual increments** (any human-facing output) the loop HALTS for a Visual Checkpoint, even when confident; a doubtful visual halts at once; nothing visual reaches the remote unseen. An unreachable state is shown on a throwaway route at narrow and desktop widths in every theme, overflow MEASURED, deleted before the next commit.

```
VISUAL CHECKPOINT - <arc> (<date>) - <N> visual increments since last check
Built:         <increment -> commit>
Expect to see: <what renders, in which states>
How it works:  <the interaction>
Questionable:  <contrast / spacing / color / copy, or "none" only if truly none>
Verify at:     <routes> -> loop HALTED, awaiting your OK
```

**LOOP SUMMARY** (BLUF, real numbers, ~12 lines max - longer means the loop ran too far without a gate):
```
LOOP SUMMARY - <arc> (<date>)
Status:  on track | blocked | goal reached
Done:    <task> -> <hash> <type: subject>     (one line per commit)
Tests:   <RED->GREEN each; N/N suite green; pre-commit passed>
Locked w/ you: <gated decisions, or "none - all pre-locked">
Decided alone: <decision -> choice -> impact test + evidence -> why, or "none">
Stopped: <gate / end / goal> -> <question or next step>
Flags/learnings: <for _Loop Learnings.md, or "none">
Next:    <exact next action awaiting your go>
```

**Learnings + graduated trust.** Capture only behaviour-changing lessons (an owner correction, a plan under-spec, an anomaly + root cause, a near-miss, a visual wrong while green) via `Flags/learnings`; review at every re-arm and phase end; a recurring or systemic one graduates here and is archived. **Repeat = REGRESSION:** hard stop, `REGRESSION: L-NN recurred`, scoreboard bump. Why: corrections falling and regressions at zero is the accuracy signal. While OFF, each manual commit notes that "begin loop workflow" is available for the next loop-worthy chunk.

### Graduated loop lessons {#graduated-loop-lessons}

Standing; a repeat is a regression. Why: each cost a real slip before it graduated.

1. **Find everything a change invalidates, repo-wide, before the first edit** - field 8's "Before the first edit" line, plus tracked public docs; a change to how a value is SHOWN searches for it AS SHOWN. The collision list comes from the scan, never memory.
2. **A test must be able to fail** - fixtures past the threshold (re-derived when it changes); disarm a second guard that could produce the same value; the break check ("Test Value") reddens an assertion, not a crash. A "nothing shown" check right after an action proves nothing; re-prove layout across the real width range.
3. **Never push escapes through a shell or tool parameter** - the Edit tool on fresh bytes, never `sed` or heredocs; prove a check fires (true on a bad character, false on ASCII) before trusting its silence.
4. **Anchor every edit on freshly read bytes** - formatters change bytes; line-scoped directives go where a formatter cannot split them.
5. **Static opaque error codes** slip in new error paths and helpers; check CI-only gates too.
6. **The tool shell's runtime** - see rule:project-adapter (A23, the owner's shell).
7. **Never `cd` into a subfolder** - use quoted absolute paths or `git -C`; the only `cd` is to the root.
8. **Stop the preview before any rebuild;** unreachable states: "Visual-correctness gate".
