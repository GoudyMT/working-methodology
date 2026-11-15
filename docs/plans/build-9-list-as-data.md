# Build 9 (1.35.0): the list and the roadmap as data, second slice of T4

Status: locked by the owner 2026-11-15 by pop-ups: option A (the list as data, no rule text), S22-10 closed, and a
wider slice on the owner's word ("if we can expand it a little bit to encompass more things that align within a
certain area, then it just makes sense"): the release-step check (K65, the owner's own ask), E14 (release notes from
the build record), the T11 ranking part, and K66 (the CI watch report). New 2, New 6 and New 7 stay with the guard step.

Swept (47 findings, 44 real, 6 high, all fixed in the build). Changes from the design below, each from the sweep: the
release check reads every fact from GitHub's API and runs in the release-notes skill too; imported rows owe their
labels only while unchanged (a record in `_State.json`, not a mark on the row); open rows rank in work order first;
sections render as bold lines and list blocks are refused in instruction and labelled files; import refuses any
table, row or cell it cannot move whole.

## Proof on the released kit (1.34.0, workbench, 2026-11-15)

- **J3 (every number says where it was measured): real.** The fact-check rule labels whether a claim was checked
  (verified, corrected, unsupported, unverifiable), never where a number came from. In the 1.31.0 and 1.32.0 verify
  files, 4 of about 13 numbers are a build thread's report restated as fact (two recall scores, a spelling count, a
  timing), with nothing marking them so.
- **J4 (a "caught by" column): real.** The list held 339 rows in 9 table shapes; none had a caught-by column. Of 222
  done or closed rows, 85 named no finder and 58 named two or more, so the catch rate could not be read.
- **S22-10: not real now.** The sweep log counts 0 open: the 1.28.0 sweep closed all 17 carried findings and checked
  each against its commit. Closed with no build.
- **K65:** 1.34.0's tag shipped with no GitHub release notes until the owner asked; no step read the real state.

## What was built

1. **`_List.jsonl`**, one row per line: one tag from a fixed set, where it sits (`at`), severity, origin (real use,
   owner, outside, the kit's own), `caught_by` (J4), `escaped`, `measured` (J3: throwaway, real use, CI, agent report,
   estimate, quote), and the row's other cells kept whole.
2. **`state.mjs list | item | step`**: the ranked open rows (T11: real use first at the same severity), `list caught`
   (catch rate, and found to shipped by origin), `list audit` (rows still owed a label), `list import` (a markdown list
   once, whole or nothing), `item add --from`, `item set`, `step set`.
3. **Generated views** between `list:begin` markers: the roadmap table with the open rows per step, the tag counts,
   and the rows by section. A hand edit is refused and caught, as in slice 1.
4. **Check:** a row added or closed since the import must carry its labels; imported rows owe them to a one-time
   audit and are counted, not failed.
5. **`release-check.mjs`** (every project): PR merged, main CI green on the merge commit, the tag on the merge's
   files, the notes published, the state check; for the kit, the release copy and the installed version. Every
   missing step is named at once. The closeout does not call a release done until it passes.
6. **`ci-wait.mjs`** (every project): one line as each CI run ends, one past ten minutes, and the result; the PR body
   skill starts it after each push.
7. **`build-record.mjs notes`** (kit only): the release notes draft from the build record, split by reach.

## Trial on a copy of the workbench list (a throwaway folder)

The first import refused, and named, what the list itself got wrong: a row with an unescaped pipe in its text, a tag
with a comma (`[CLOSED, trials done]`), and a blank line that split the E table so 30 rows showed as plain text. With
those three fixed in the copy, all 342 rows and 17 roadmap steps moved; the generated counts (188 done, 34 closed,
6 next, 89 later, 3 after, 7 separate, 13 owner, 1 standing, 1 plan) equal the hand recount. The workbench's own
list moves on the owner's word, after the release; the three fixes go to it first.

## Cost and reach

$0 cash; CI on the kit's public repo, $0. No rule text, so no recall run. One feature sweep. Reach: every project at
its next install (`state.mjs`, `list-data.mjs`, `release-check.mjs`, `ci-wait.mjs`, the closeout and PR body skills);
the release notes draft is kit only.
