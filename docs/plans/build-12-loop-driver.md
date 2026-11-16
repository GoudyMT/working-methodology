# Build 12 (1.38.0): the loop driver, T7 slice 1

Locked by the owner's pop-up, 2026-11-16: scope "Wide"; the bounds file changes only on the owner's pop-up Yes for
that exact edit; recall v12 key 4; branch `feat/loop-driver`.

## Why

The teardown (workbench `results/kit-teardown/evidence/skills-agents.md`, 4c) counted 26 stop rules in the kit: 6 held
by code, 3 partly, 17 only in prose. Six numeric limits have no counter. The kit's own line is "A limit needs an
instrument". T7 gives the build loop one: a script that owns its state, says the one next step, counts the stops that
have a number, and prints a triage card when it stops (E11).

## Native tools checked first (the plan's first move)

- Claude Code workflows run a script of agent calls in the background. They hold no state across a compaction and
  stop nothing in the main session.
- `/loop` re-wakes a session on a timer. It keeps no counters and holds no stop.
- Neither can be the driver. Either can call it, since the driver is a plain script.

## What it is

`project/.claude/loop.mjs`, installed into every project (reach: every project that uses the kit).

- **State:** `<git common dir>/kit-loop.jsonl`, hash-chained like the sweep log. The guards hold any tool write to
  `.git/kit-*`, so only the script writes it; a hand edit breaks the chain and halts the run.
- **Steps:** the bounds file's ordered list. `next` prints the one next step, whether Claude does it alone or it is the
  owner's, and the act to quote. `done <step> --evidence` refuses a step out of order.
- **The owner's steps:** `done` needs the owner's Yes after the step opened, to `` `loop <step> <code>` `` or, with
  `--act`, to the outward act the guard already asked for (merge, tag), so no step costs a second tap.
- **Counters:** fix rounds and canary misses per unit, visual increments since the last check, CI fixes (counted, no
  cap: the owner's ruling, 2026-11-15). A limit from the bounds file halts the run with a card.
- **Halt and resume:** a halt stops every step; only the owner's Yes to `` `loop resume <code>` `` resumes.
- **Kill switch (I11):** `autonomy-off` in the Claude folder, the merge gate's switch, makes every step the owner's.
- **Loop mode in code:** armed only when the session's latest owner message is exactly "begin loop workflow"; the
  prompt hook halts it on any other owner message; session start and compact turn it off.
- **The bounds file (J6):** `.claude/bounds.json`, seeded once by install and then the owner's. The guards treat it as
  a settings file: a tool writes it only on the owner's pop-up Yes to that exact edit. The run keeps its hash and
  halts if it changes mid-run.

## Stops moved from prose to code

Arming, halting on an owner message and off after a compact (one rule); fix rounds; canary strikes per unit; visual
increments; no build before the design lock. With the six already held, 11 of 26.

## Rows

E6 (part), E11 (part), J6, I2 (the grant paths are the owner's: the bounds file), I11 (the kill switch read outside
the merge gate). I1, I4 and I15 close as replaced by this design. Slice 2: E13 watchers, plan self-approval in shadow
mode, thread chaining.

## Known limits

The driver counts what it is told. A session that never calls `count` is not stopped by a counter; the card and the
rule text name the call, and the canary and the sweep still read the work.
