# Explore the Goal and Generate Options

Loaded by Steps 2-4. The goal-first method itself is rule:goal-before-mechanism; this file is the craft that
feeds it.

## Ground to cover (territory, not a script)

Never read these out as a list of questions. Cover them through the conversation:
- what kind of thing this is, and what makes it different from what exists;
- why now - what triggered it - and what success looks like to the owner;
- who has the problem, how often, and what they do about it today;
- goals, non-goals, and anti-goals (what would make it a failure even if it technically works);
- prior art the owner has seen, liked or hated;
- the current state: what exists, what was tried, what the code already uses;
- how it gets made: which choices (platform, library, storage, layout) the owner wants to make, which are
  handed to you, and what already exists to build on. In existing work, build on what it already uses. Any
  choice you make goes in the design as your call, never as something the owner agreed to.

Why: each item missed here becomes a guess later, made without the owner.

## Questions that work

- Anchor in a specific moment: "Walk me through the last time...", "If it could do only one of these well,
  which?", "What would make you wince if I got it wrong?"
- A correctable guess ("I am guessing this is because X keeps failing on the phone?") often beats a question.
- When the owner says "just guess" or "what do you think?", propose something concrete.
- Match the owner's words; no process jargon (rule:owners-rules #8).
- Some questions cannot be answered by talking, only by data. When the talk circles, stop and name the
  measurement or the read that would settle it (rule:goal-before-mechanism: the deciding measurement first).

## Probe the problem before the solution

- **Symptom vs root:** keep asking why until you reach something structural. A request often names a symptom.
- **Who, and how it varies:** a problem rarely hits every user the same way; ask which group feels it most.
- **The do-nothing case:** what happens if we build nothing, and who is hurt?
- **Kind of gap:** is it awareness (they do not know), ability (they cannot), or motivation (they do not care)?
  Each needs a different fix.
- **The job:** "When <situation>, I want to <motivation>, so I can <outcome>." The job outlasts any one
  solution; the thing the user stops using to use ours is the real competition.

## Test the assumptions

List every assumption the idea rests on, stated or not, then sort by category:

| Category | The assumption | The question |
|---|---|---|
| User | they want this | what evidence, from how many people? |
| Problem | it is real and frequent | how often does it happen; how much do they care? |
| Solution | this approach works | why this one; what did we dismiss? |
| Value | it moves the goal | which measure, by how much? |
| Feasibility | we can build it | on this stack, offline, at this size budget? |
| Adoption | people will find and use it | where do they meet it; what habit must change? |

For each: how confident, what evidence, what would disprove it. Name the **riskiest assumption** (wrong ->
the idea dies) and the **cheapest test** that settles it before building (a probe, a read of the data, a
wireframe the owner reacts to, a throwaway spike). A probe proves only what it ran (rule:probe-scope).

Then argue the strongest case against the idea, once, in plain words.

## Generate options (diverge, in private)

Aim for 5-7 distinct ideas before judging any. Vary them along real axes:
- **Scope:** a small tweak vs a larger bet.
- **Kind:** a product change vs a content change vs a process or copy change.
- **Time:** a quick win vs a durable build (rule:dual-horizon).
- **Always include** one option that removes something instead of adding, and one that does the opposite.

Techniques, used only when stuck:
- **Remove a constraint**, design freely, then walk back to what is feasible.
- **Borrow:** how does another field solve the same job?
- **Invert:** list how to make the problem worse, then reverse each item.
- **Split:** break the problem into parts, solve each, recombine.
- **Switch the user:** a first-timer, a heavy user, someone tired on a phone, someone who distrusts the app.
- **Seven lenses on what exists:** substitute, combine, adapt, scale up or down, reuse elsewhere, remove,
  reverse the order.
- **"How might we <outcome> for <user> without <constraint>?"** - not so broad it means anything, not so
  narrow it is already a solution.

## Converge

- Group related ideas; judge each on user impact, feasibility, fit with the locked architecture, and the
  strength of its evidence.
- Keep the 2-3 that survive; for each, name its biggest unknown and the cheapest way to settle it.
- Drop any idea that fights what the owner said about why.
- Present them in the A/B/C shape (rule:collaborative-design-locks), the rest of the space one line each.
- Be opinionated: "I recommend B because..." beats a neutral table.

## Traps to name out loud

| Trap | What to do |
|---|---|
| Solution before problem ("we should build X") | Ask what problem X solves and how we know. |
| Copying a competitor ("they have X") | Ask what need X serves and whether there is a better way to serve it. |
| One-idea "brainstorm" | Acknowledge it, then ask for two others. |
| Anchoring on a constraint too early | Explore first, then check feasibility. |
| Endless exploring, no pick | "If you had to pick one now, which and why?" |
| Talking where data is needed | Stop; name the read or measurement. |

## Capture

At the end, write down: the ideas kept and why, the assumptions to test, open questions, the next step, and
what was set aside (as parking-lot lines, rule:parking-lot). A brainstorm with no record did not happen.
