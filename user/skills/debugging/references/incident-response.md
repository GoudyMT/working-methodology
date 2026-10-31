# Incident response

Used when users are affected now. Why: during an incident, order and clear roles beat cleverness.

## Order of work

1. **Detect and confirm:** is it real, who is hit, since when. Check the latest deploy, config and flag
   changes first; a rollback is often the fastest mitigation.
2. **Classify severity** (adapt the times to the team; a solo owner still uses the levels):

| Level | Meaning | Response |
|---|---|---|
| SEV1 | Service down or all users hit; data or security at risk | Immediately, drop everything |
| SEV2 | Major feature degraded, many users hit | Within about 15 minutes |
| SEV3 | Minor issue, some users hit | Within about 1 hour |
| SEV4 | Cosmetic or low impact | Next working day |

3. **Assign roles** (one person may hold several in a small team, but name them): incident lead (decides,
   keeps the timeline), communications (writes updates), responders (investigate and act). The lead does not
   debug; the debugger does not write updates.
4. **Mitigate before you diagnose:** roll back, disable the flag, scale, fail over, block the bad input.
   Prefer the reversible action. Record each action with its time.
5. **Diagnose** with SKILL.md steps 2 to 8 once harm is contained, or in parallel by a separate responder.
6. **Confirm resolution** with a fresh check of the user-visible symptom, then watch for a set period.
7. **Postmortem** within a few days, while memory is fresh.

Privacy: an incident that may expose personal data is its own track. Stop, preserve evidence, and tell the
owner at once (rule:security-standards).

## Status update shape

Send on a fixed cadence (SEV1 about every 30 minutes) even when nothing changed; say "no change" and the next
update time. Contents: severity and state (investigating, identified, monitoring, resolved); who is affected;
what we know; what we have done; what happens next and when the next update comes. Facts only, no guesses
about cause, no blame. Drafting is free; sending to users, a channel or a pager is an outward act that needs
the owner's go (rule:outward-acts).

## Postmortem shape (short, blameless)

Blameless means: the system and process allowed the error, so ask what made the mistake easy, not who made it.

- **Summary:** 2 or 3 plain sentences.
- **Impact:** who, how long, any data effect.
- **Timeline:** time and event rows, from first sign to resolution, including the detection delay.
- **Root cause:** the cause sentence from the investigation, plus the trigger.
- **Why chain:** ask "why" until you reach something you can change (usually 3 to 5 steps); stop at a cause
  in process or design, not at a person.
- **Went well / went poorly:** two short lists, including how fast it was detected.
- **Actions:** each with an owner, a priority and a date; at least one that prevents recurrence and one that
  speeds detection. An action with no owner is not an action.
- **Lessons:** recorded in the project's lessons file so a repeat counts as a regression.
