---
name: measurement-and-evals
description: Read when building or reading a benchmark, harness, scan or LLM judge, or when a number would justify rework.
metadata:
  type: feedback
---

**A surprising number is first a claim about the instrument.** Validate the instrument before the verdict.

- **A harness fails pessimistic** (scope too narrow, an early abort): a low number is the shape a broken harness makes. Build in a fidelity check and show it passing; probe that a known-good case scores 100%.
- **A hand-written pattern fails optimistic** about its precision. Print every match with context and read them all before counting. The false-positive rate is the finding.
- **Run a control every time.** Show the instrument separates known-good from known-bad in THIS environment before reading it. Storage modes, throttle knobs, runner timings and one-line shell checks are instruments too.
- **An LLM judge prompt is code.** Plant known-bad and known-good cases each run and read them first. One sentence in a judge prompt can blind it to the very class under test.
- **Judge the surface the reader sees**, not the bare string.
- **Never compare counts across runs whose instrument changed**; only the within-run paired figure holds.
- **Re-measure after any change to measured code.** A floor rises only on a reading from an unchanged instrument. State corrections plainly, in the code comment too.
- **Before costly rework, run one measurement designed to refute the number.**

**Eval rigor**
- **Tune on a TUNE split; gate on a frozen HELD-OUT split**, frozen before tuning (deterministic hash split). Reporting on tuned data is leakage. Eval and runtime share the same code; keep the knob search coarse.
- **Write eval questions from a person's situation**, cold, then check whether the data answers them. Questions written backwards from a passage share its wording and inflate the score. Score new items apart from old ones; a big gap is the tell. "Grow the benchmark until the gate passes" is a smell.
- **Text both embedded and displayed: embed raw, clean at display.** Readability edits to embedded text perturb rankings even when meaning is unchanged. Keep the display cleaner a pure function off the embed path.
- **Relevance needs per-item curation.** Tag or category matching dumps mostly-irrelevant items. Curate 0-3 genuinely useful items per host by judgment; some hosts get none. Guard the map with an integrity test.

Related: [[verification-and-evidence]], [[goals-and-design-thinking]].
