# Build 5 (1.31.0): the sweep shape, and the guards that ran twice

Status: built on `feat/sweep-shape-and-guard-starts`; the owner approved the scope by pop-up on 2026-11-14.

## 1. The sweep shape (the owner's lock)

The cut of three review roles (test value, dimension, novel lens) had a bar set on 2026-11-12, scored on the three
trial builds (1.28.0, 1.29.0, 1.30.0). It needed all three to hold:

| Condition | Result | Evidence |
|---|---|---|
| 1. Every high a leaving role found was also caught by the plan check or CI | Fails | 1.28.0: H1, H2 (novel lens) and H6, H7, H8 (dimension) were caught by the sweep only; 1.30.0: a security test that could not fail (test value) |
| 2. The plan check named a third or more of each build's highs | Holds | 10 of 18, 7 of 12, 7 of 10 |
| 3. No high escaped to a later build | Fails | 1.29.0's H2 to H4 were on 1.28.0's main; K51 was found after 1.30.0 shipped; K48 and K49 surfaced in a project on a release |

The owner's pick: every role stays. What the trials proved goes in: the plan gap check becomes a step of the plan
skill (its fixed brief ships beside it), and every feature or launch-gate sweep report counts its highs by the
layer that caught them (`- **Layers:** plan <n>, CI <n>, sweep <n>, escaped <n>`), which the report audit enforces.
No rule module changed for this: both live in skills (the plan skill and the sweep skill).

This build ran no plan check of its own: its scope was a list of proven defects, approved row by row. The sweep's
novel-lens role runs the plan check's six lenses over what was built instead.

## 2. Guards that ran twice (K48, K49, K50) and S155

Proof on the released 1.30.1 in a throwaway install with its own Claude folder:
the old 1.24.0 settings shape beside the launcher refused the same reviewer start as "started already" (K48a); a
start the task gate refused still claimed its slot (K48b); install and status never named the old entries (K49);
`--outcome --none-ran` refused a round whose only start never ran (K50). S155: the owner-yes check gave the same
yes on both runs of one call, so the double run is not what loses the first pop-up tap; its cause stays unknown.

- **K48a:** a taken slot that holds this start's own tool id passes (`sweep-guard.cjs`); a start with no id never
  matches.
- **K48b:** `guard.cjs` does not run the sweep guard for a call any earlier guard already refused (a project guard,
  or the canary; the sweep found the canary case).
- **K49:** `install project` takes every PreToolUse hook that runs a kit guard from its kit place
  (`.claude/<guard>.cjs`, `kit-hooks/<hook>.cjs`) out of the project's settings files, with a backup, as it
  already did for 1.25.0's `guard.cjs` entry; status and the session-start notice name any that remain
  (`kit-launch.cjs` `oldGuardEntries`). The owner said yes to removal beside naming. The sweep found the first
  match, by file name in any folder and event, removed a project's own hooks; it now reads only the kit's places,
  in the whole command text, and leaves groups of odd shape alone.
- **K50:** `--none-ran` counts a slot as never ran only on proof: a session transcript holds a refused result for
  its tool id and no agent's meta file names it. No transcript found (a moved or emptied Claude folder) means ran;
  the sweep found the first version failed open there.

## 3. Plain reads the guards refused (K54)

Reproduced on 1.30.1: `cd .claude && cat guard.cjs | head -5` (owner-proof: a pipe anywhere made every cd unsure)
and a project's PowerShell count line (guard-delete: a quoted regex read as a command named "a program by a
wildcard"). Not reproduced on 1.30.1: the bash bracket class, `$( )` and jq cases. Fixes: a cd stays followed when
every pipe stage only reads (no `||`, `&`, or pipe into a writer such as `xargs cp`); a quoted pattern after a
PowerShell match, like, replace or split operator skips only the wildcard-program-name check, every other delete
check still reads it. The sweep found the first fixes let 18 delete and overwrite spellings through; each is now a
planted case. The bar: every planted write and delete still held (772 of 772 delete cases, owner-proof and
guards-hold suites).

## 4. The rest

- **MC2:** recall sessions run `--model claude-opus-5-5 --effort medium`, recorded in each run's header; a test
  holds every agent role file to a full model id.
- **MC4:** the Haiku price line (PR 37, merged before this branch).
- **K17:** timed on PR 37: unit tests 1m03s with the map (2m46s full), whole CI 1m46s. The map stays; closed.
- **K53:** `write` names a preview cut apart from a missing label.
- **Rule 11 and the orientation protocol** name the Active Plan beside the files the Resume Point names; recall
  keys v10 change key 3 to match.
- **M27:** the sweep counts new guard spellings again (the race measure).

## 5. Limits

- A quoted pattern after `-match` and its kin is never run by PowerShell, so the wildcard name check skips it; a
  program that ran such an argument as a command would not be held by that check (the others still read it).
- K49 removes entries that name a kit guard in its kit place; a hook that runs a guard through another wrapper
  script is not seen.
- K50 trusts the Claude folder's transcripts as proof of a refusal; a refused result there is written by Claude
  Code and the guards refuse tool writes to the transcripts.
