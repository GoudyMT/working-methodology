# Build 8 (1.34.0): state as data, first slice of T4

Status: locked by the owner 2026-11-15 (pop-up: "State + decisions", no fold-ins); built on `feat/state-as-data`; swept (39 findings, 5 high, all fixed in the build). Built as below, with these changes from the design, each from the sweep:

- `kit` is in the data, and `check` fails when the installed kit (`.kit/kit-version.json`) differs: the drift on 1.33.1 came in at installs, and the views alone could not show it.
- `render` refuses a block edited by hand since the last render (a hash of each rendered block is kept in the data); `render --overwrite` writes over it once the change is in the data.
- `decide --from <file.json>` takes its input from a file, so the guards never read the owner's words as a command. The words must be found word for word in the owner's messages or pop-up answers in the session's transcript, or are recorded with `--unchecked`, marked so. Rows are appended under a lock; `check` fails a committed row that changed.
- The resume packet does not hash `_State.json` (design item 5 dropped): the Active Plan is read in full every session, and `check` fails when the data and the views differ, so a data-only edit is already caught.
- The Active Plan's own "Current Phase" section is gone from the template; the phase lives in the data.
- Commands run one per call: the guards refuse a chained command that names a `.claude/` file.

Trial on a copy of the workbench's 1.33.1 tracking files (`C:\Users\Max\kit-probes\b8-state-trial2`): `init` moved NEXT, the loose "Then MC3 ..." paragraph and the three pending items into the data; `check` passes. A closeout's hand edits after: the Session Log entry, the Working Memory index line and the Master Roadmap box (3; the rest are `state.mjs` commands). The next action is stated by hand in 1 file (`_State.json`), against 4.

## Proof on the released kit (1.33.1, workbench, 2026-11-15)

T4 is real. Four files state the next action, each by hand, and three of them are two releases stale while the list is current:

| File | What it says now | True state |
|---|---|---|
| `_Active Plan.md:15` | "NEXT: build 6 (1.32.0)" | 1.33.1 is out; next is build 8 (1.34.0) |
| `_Working Memory.md:11,13` | "kit 1.31.0 installed ... build 6 next" | kit 1.33.1 installed |
| `_Master Roadmap.md:46-47` | build 6 unchecked; "T4 ... (1.33.0 and on)" | build 6 and 7 shipped; T4 is 1.34.0 |
| `_Kit Improvement List.md:39` | "8 and on, 1.34.0 and on" | current |

The closeouts of 1.32.0, 1.33.0 and 1.33.1 updated the list and nothing else. The second half of the T4 row ("`_Active Plan.md:18-21` holds leaked tool markup") is no longer real: the file is 25 lines with no markup.

Folded rows, checked:

- **A7, J7** (a tracked record of the owner's decisions, with ids and a pointer check): real. The workbench has 0 decision records; decisions live in a table in PLAN.md section 2 and in memory files, with no ids. The kit ships `_Decision Record Template.md` (ADR shape) but nothing for a one-line ruling.
- **E15** (a waiting area: needs the owner's eyes, does not block): real. `_Active Plan.md` has one "Pending the owner" list that mixes blocking and non-blocking items.
- **E9** (the coordinator opens the next thread after a hand-back): real by absence. The closeout skill names the coordinator once (`user/skills/closeout/SKILL.md:38`) and says nothing about the next thread.
- **J4** (a "caught by" column on the list) and **J3** (every number labelled where it was measured): both are about the list itself. They go with the list slice (below).
- **S22-10** (reconcile 1.22.0's "carried open: 17"): every S22 row now carries a DONE, CLOSED or LATER tag (list lines 225-246). It is a workbench history row; the list slice's one-row-one-tag check closes it.

## The slice for 1.34.0 (recommended)

State and decisions as data. The list and the roadmap as data are the next slice (1.35.0).

1. **`_State.json`** in the project root (tracked; `.kit/` is gitignored). Fields: `updated`, `kit`, `phase`, `next` (one action and a pointer), `then`, `blocking` (needs the owner before work goes on), `waiting` (needs the owner's eyes, work goes on: E15), `carry_overs`, `last_session`.
2. **`_Decisions.jsonl`**, append-only: `id` (D-1, D-2 ...), `date`, `decision`, `words` (the owner's own words), `why`, `supersedes`. Covers A7 and J7.
3. **`.claude/state.mjs`**: `show` (the query: next, blocking, waiting), `set`, `add`, `done`, `decide`, `decisions [text]`, `render` (writes the generated blocks), `check` (exit 1 when a generated block differs from the data, or a `D-n` cited in a tracking file has no record).
4. **Generated blocks** between markers in `_Active Plan.md` (Resume Point) and `_Working Memory.md` (the three dashboard lines). Text outside the markers stays the owner's.
5. **Wiring:** the closeout skill runs `state.mjs set ... && render && check` in place of hand edits; `kit.mjs status` and the use check report drift; the resume packet hashes `_State.json`. E9: one closeout step says the hand-back names the next thread from `state.mjs show`, for the coordinator to open.
6. **Rule text:** one pointer line in `rules/tracking-and-handoff.md` (the next action lives in `_State.json`; the Resume Point is generated). Behind one recall run.
7. **Existing projects:** install adds the two files only when missing; `state.mjs init` seeds `_State.json` from the current Resume Point once.

## Pass bars (set before the build)

- Files that state the next action by hand: 4 to 1 (the data; views are generated). Measured in a throwaway copy of the workbench.
- Hand edits per closeout: 10 to 15 today, 3 or fewer, on the same copy.
- A hand-edited generated block is caught by `check` (failing-first test). A `D-n` pointer with no record is caught (failing-first test).
- Recall: no drop against the 1.33.1 baseline; the bar is not touched.

## Cost and reach

$0 cash. CI on the self-hosted runner, $0. One local recall run on the subscription. One aimed review. Reach: every project at its next install (project-layer script and templates, the closeout skill in the user layer, one rule line).
