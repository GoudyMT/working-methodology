# Parallel dispatch: when to fan out, how to brief, how to wait

Load this when the lead faces two or more separate problems (failing tests, broken areas, questions to research) and
is deciding whether to send agents at them at once. `agent-team-build` already owns: the mode choice, the units of a
planned batch, builder worktrees, and "default is direct execution". This file covers the unplanned fan-out:
diagnosing several independent failures or questions, and the mechanics of waiting on agents.

Why: separate problems investigated one after another waste wall time, but agents pointed at related problems
duplicate work or collide, and a fan-out costs more total compute than doing it directly.

## 1. The independence test

Fan out only when every answer is yes:

1. Different root causes? Group failures by what is broken, not by when they appeared. If fixing one could fix
   another, they are one problem: one investigator.
2. Can each be understood without the others' context?
3. No shared state: no common file to edit, no shared port, fixture, server or store.
4. Do you already know what is broken? If you do not (exploratory), look first, directly or with one scanner, and
   fan out after the groups are clear.

Any no: run it in order, or give it to one agent. Three or more groups is the usual point where fan-out pays; two
small groups are usually faster done directly.

Done when: each group is named in one line with the evidence that it is separate (rule:enumerate-before-you-count:
list the failures, then group them).

## 2. Read first, write only inside a lane

- The default fan-out is read-only: investigators report the root cause with evidence, and the lead decides the fix
  through the finding pipeline (rule:finding-pipeline). Parallel agents that edit one working tree are forbidden
  (rule:patterns-and-dispatch).
- When a group needs a fix written, hand it to a builder in its own worktree on a file list no running unit shares
  (`agent-team-build`, flow step 3). Check the file lists against each other before the dispatch.
- Never let an agent "fix" a failing test by relaxing the test, adding a timeout or skipping it (rule:test-integrity).
  Say so in the brief for any timing or race failure: the task is the root cause.

## 3. The brief for each agent

One brief per group, written so a fresh reader can act on it with no chat history. It carries:

- **Scope:** one test file, one subsystem or one question. Name the files.
- **Evidence:** the exact error text, test names and the command that shows them. Paste, never "as discussed".
- **Goal:** what a finished answer looks like (a root cause with file:line, or a named test passing).
- **Constraints:** what must not change ("production code stays as is", "read-only").
- **Return shape:** root cause, evidence, proposed change, what it would break. Short, in the final message.
- **Model:** set it explicitly. An omitted model inherits the lead's, usually the dearest. Mid tier is the floor
  for work that needs reading and judgment; a small tier only for lists and counts that the requester re-checks.

Common mistakes: scope too broad ("fix all the tests"); no context ("fix the race"); no constraints (the agent
refactors); vague output ("fix it").

Done when: each brief names a scope, evidence, a goal, a constraint and a return shape.

## 4. Dispatch and wait

- Send every dispatch in one message so they run at once; one per message runs them in order.
- Keep working while they run (ledger, reading, packaging the next review). Results arrive on their own.
- When truly idle, wait in bounded stretches of 5 to 10 minutes, not a tight poll and not one silent open-ended
  wait. Between stretches, post one status line and list the live agents. Chase any that finished without
  reporting. A stuck or lost agent should be noticed in minutes. Do not declare an agent dead from one look: a
  growing run record means it is working.
- Hand large inputs over as files, not pasted text: a pasted brief or diff stays in the lead's context and is
  re-read on every later turn. Put such files in the scratchpad, outside the repo. (Results still come back in the
  final message, not files: rule:patterns-and-dispatch.)
- Many tiny same-shape edits (one constant changed across files) go to one agent in one brief with every file and its
  change listed, reviewed as one diff. One agent per task is for work with its own judgment or tests.

## 5. Integrate and verify

When the agents return:

1. Read every summary. Treat each as a claim, and re-weigh it with your fuller context (rule:anti-hallucination):
   a real finding, or an artifact of narrow scope?
2. Check for overlap: did two agents touch or conclude about the same code?
3. Apply the fixes through the normal flow, one root per commit, and run the project's full gate once on the result.
4. Spot-check one claim per agent against the code itself. Agents make systematic errors; a clean summary is not
   proof.

Done when: the gate is green on the combined result and each agent's claim you relied on was checked directly.
