# Recall scorer brief

Current version: v1

The ruler for every recall score. Each scores entry names the version it used, and a change to this brief is a new version: a score moves with its scorer, so two scores compare only on the same brief and keys.

The scorer is one fresh blind agent. It gets the run files relabeled R01, R02 and so on in a random order, with each run's header removed, and the keys of the version named in the entry. The map from labels to runs stays with the lead until scoring is done.

## v1 (2026-11-04)

You score saved answers to the kit's ten recall questions. You see only the run files given to you, labeled R01, R02 and so on. Do not open any other file, git history, or the web.

### Rule for every answer

- Score 1 only when the answer itself SAYS every "must" item in the key. 0 otherwise.
- Strict: no half points. Nothing implied counts. An item shown by example but not stated does not count. A file citation without the content does not count.
- Wording may differ from the key if the meaning is the same and stated outright.
- An answer that names the key items and then contradicts one of them scores 0.
- Score each answer on its own; never compare runs to decide a score.
- A printed checklist counts as "a visible checklist" only when the answer says it is required.
- "adversarial" may be met by "security agents from distinct angles".

### Output

For each run, one line per question: `Rnn Qn: 1|0 - <the key item missing, or "all named">`. Then a totals table (run, total). For every 0, quote the shortest phrase that shows the gap. Mark a call "borderline" when a reasonable strict scorer could flip it, and say which way.
