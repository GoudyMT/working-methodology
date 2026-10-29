# Sweep Auto-Approval + Canary Hand-Back Fix (release 1.5.0)

**Goal:** a routine sweep (feature, fix, triage) whose Swarm Contract stays inside the rules the owner set runs
without waiting for the owner, decided by a script (no tokens, same answer every time), with every decision and
outcome logged and a 10-sweep trial. Also: the canary must check reports handed back through a tool (the desktop
app), which it logged as "unchecked" in the first long real run. The owner's go, 2026-10-29.

## Decided

- The owner: build it as a script with a trial (the recommended option).
- Claude (delegated, reported): first push and launch gate always go to the owner; unknown tiers, kinds and
  modifiers go to the owner; the trial pauses every 10 approvals and on an overrun (tokens >= 1.25x budget), a third
  of findings repeated, or an escape; only the owner resumes (KIT_OWNER_RESUME=1). Starting caps are placeholders
  to set from the trial log, not measured values.

## Progress

- [x] Canary: read the hand-back from the agent transcript (test red first; shape taken from a real transcript).
- [x] approve.mjs: rules, clones, caps, log, outcome, escape, pause, resume, summary (3 tests red first).
- [x] rule:sweep-auto-approval; swarm-contract line amended; pre-pr-sweep steps 2 and 6.
- [x] Review and short re-check, both fixed; real-transcript checks; recall 9/10; bump to 1.5.0.
- [ ] Push and install on the owner's go.
- [ ] Trial: 10 auto-approved sweeps, then the owner's review of the log.
