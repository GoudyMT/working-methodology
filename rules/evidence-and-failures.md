---
id: evidence-and-failures
load: on-demand
when: When something fails, a number surprises, or a probe is planned.
tags:
  failure-response: failure, error, broken, triage, debug
  enumerate-before-you-count: numbers, counts, metrics, surprising results
  instruments-and-evals: eval, benchmark, measurement, harness, results
  probe-scope: probe, experiment, investigation scope
  snag-response: stuck, blocker, workaround, snag
---

# Evidence and Failures

## Failure Response Discipline (Triage Before Fixing) {#failure-response}

Run BEFORE touching code when a test fails, a build breaks, or behaviour surprises. Why: guessing at a mis-triaged failure burns hours and adds worse problems.

1. **Triage:** production bug or test-environment artifact? In scope now or deferred? -> fix / defer / document as residual.
2. **Diagnose with data:** the FIRST action dumps real state (computed values, requests, served bytes, env), not a fix; after 2 failed attempts stop guessing and dump; an unobservable bug is instrumented (an on-screen readout, a log; stripped after) before any fix. A step failing in one second is a script error until its log says otherwise; a CLI's empty error has its cause in its log file; search the roadmap and parking lot for the symptom first.
3. **Verify before push:** run affected suites locally before committing (E2E is often outside the hook); CI / config changes land in the SAME commit as what needs them.

## Enumerate Before You Count {#enumerate-before-you-count}

**A count from a pattern you invented measures the PATTERN** (it fails optimistic). Before a class detector ("junk", "violations") yields a number: (1) print and read every match in context (too many = too broad); (2) report the false-positive RATE, not the total; (3) count distinct matched tokens and neighbours (two findings can wear one number); (4) anchor the rule on what enumeration showed. A capped search is not an absence; a grep finding your own new text is not verification. Why: a speculative count justifies expensive, content-destroying remediation.

### Instruments and Evals {#instruments-and-evals}

**A surprising number is first a claim about the instrument.** Why: a broken harness and a real result look the same until a control separates them.
- **A harness fails pessimistic** (scope too narrow, an early abort): build in a fidelity check; a known-good case must score 100%.
- **Run a control every time:** the instrument must separate known-good from known-bad in THIS environment; storage modes, throttles, runner timings and one-line shell checks are instruments too.
- **An LLM judge prompt is code:** plant known-bad and known-good cases each run and read them first (one sentence can blind it); judge the surface the reader sees.
- **Never compare counts across a changed instrument;** only the within-run paired figure holds. Re-measure after any change to measured code; state corrections plainly, in the code comment too. Before costly rework, run one measurement designed to refute the number.
- **Tune on a TUNE split; gate on a HELD-OUT split frozen before tuning** (deterministic hash split); eval and runtime share code; a coarse knob search. Reporting on tuned data is leakage.
- **Write eval questions from a person's situation,** cold - written backwards from a passage they share its wording and inflate the score; score new items apart from old (a big gap is the tell); never grow the benchmark until the gate passes.
- **Relevance needs per-item curation:** tag matching dumps mostly-irrelevant items; curate 0-3 per host by judgment, guarded by an integrity test.

## Probe Scope {#probe-scope}

**A passed probe proves only what it ran.** List it beside the real use row by row (model, tools, depth, place, length, load, data), each **MATCHED** (run as the real use will), **GATED** (a new probe passes before anything builds on it) or **CANARY** (the first small real run shows it; name what to watch); no row unmarked. Assumptions only a real test can settle are gates that pass first. Ship the de-risked local part first; put the risky integration behind its probes. Why: necessary is not sufficient.

## Snag Response: Least-Invasive Path, No Padding {#snag-response}

After triage and diagnosis: (1) recommend the LEAST-INVASIVE path (no change -> local or config change -> the owner's global environment, last resort, explicit OK); (2) recommend, don't lock - one good option is presented as one; (3) verify the path before asserting it; (4) document snag + fix where it belongs (Session Log, plan notes, `_Loop Learnings.md`, ADR). Why: padding buries the recommendation, and an undocumented snag recurs.
