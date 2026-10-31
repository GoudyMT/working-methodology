# The Design Doc

Loaded by Step 5. The test of a design: a capable builder in the domain could plan from it without going back
to the owner. Short beats complete; every section earns its place.

## Where and how long

- **Small change:** in chat, about 150-300 words: intent, the chosen approach, the files it touches, what is
  out of scope, how it will be checked.
- **Project:** a file where adapter A22 puts design docs (the spec folder), named `YYYY-MM-DD-<topic>-design.md`
  (check the machine's timezone before dating it, rule:anti-hallucination). A structural decision inside it also
  gets an ADR (the adr skill, rule:sdd-triangle).
- Scannable: a reader of only the headings and bold text gets the gist.

## Sections (project size; drop any that would be empty)

1. **Intent and why** - the problem in 2-3 sentences: who has it, how often, the cost of not solving it, and
   the evidence (a user report, a measurement, a support message), not opinion.
2. **Goals** - 2-5 outcomes, not outputs ("a first-time user finds their timeline in under a minute", not
   "build a wizard"). Each answers "how will we know it worked?"
3. **Non-goals** - 2-5 things it will not do, each with a one-line why (low value, too large, separate work,
   premature). **Anti-goals** - what would make it a failure even if it works (for example: any personal data
   leaving the device).
4. **Constraints** - Tier 0 boundaries that apply (adapter A2-A5), stack, size budgets, delivery context
   (adapter A24), deadlines.
5. **What the owner decided** - each lock, as they decided it, with its date.
6. **The approach** - the chosen option and why; the rejected ones in one line each with the reason.
7. **Requirements** - sorted, and ruthless about the first group:
   - **Must** - without it the feature does not solve the core problem. Test: "if we cut this, does it still
     solve the problem?" If everything is a must, nothing is.
   - **Should** - clearly better with it; the core works without it; built soon after.
   - **Later** - not built now, but the design must not block it (it shapes seams, rule:dual-horizon).
8. **Acceptance criteria** - per must-requirement, Given / When / Then or a checklist. Cover the normal path,
   the error and empty states, the boundaries, and what must NOT happen. Each is independently testable. No
   vague words ("fast", "intuitive", "seamless") - put a number or an observable behaviour in their place.
   These become the plan's tests (rule:tdd: acceptance criteria as test specs first).
9. **Success criteria** - from the Success Charter when one was written (rule:success-charter); honest
   qualitative bars where a number would be invented.
10. **Risks and open questions** - each tagged blocking (answer before building) or non-blocking, and who can
    answer it (the owner, a probe, a source). Do not list a question the records already answer.
11. **Left to the builder** - what any sensible builder may settle alone.
12. **Your calls** - each choice you made without the owner, marked so they can check it while reading.

## System design checklist (when the work adds or changes structure)

Answer only the lines the work touches:
- **Functional:** what it does, per user action.
- **Non-functional:** size, speed, offline behaviour, storage limits, cost (adapter: zero operator cost where
  it applies), accessibility.
- **Parts and flow:** the components and how data moves between them - draw it if a picture is clearer
  (rule:diagrams: every arrow gets a verb).
- **Contracts:** each interface between parts - names, inputs, outputs, errors.
- **Data:** the shape stored, where it lives (rule:security-standards and adapter A4 decide where personal
  data may go), how it migrates from the last release, how it is deleted.
- **Failure:** what happens when each dependency is slow, missing or wrong; retries and their limits; what the
  user sees.
- **Growth:** what you would revisit when the data, the users or the features grow, and the trigger for it.

For each choice with real alternatives, compare on: complexity, cost now and later, fit with what the team
(one person plus AI, rule:owners-rules #5) already knows, upkeep, and reversibility. State the consequences
plainly: what becomes easier, what becomes harder, what must be revisited.

## The builder check (projects only)

Before handing the doc to the owner, give it to a fresh read-only agent with no chat history and this brief,
in our words:

> You are a capable <domain> builder handed this design to plan from. You cannot ask its author anything.
> Read <path>. List only the questions you would have to guess at, where a wrong guess changes what gets
> built. For each: the question and why the answer changes the plan, ranked by importance. Skip anything the
> doc leaves to the builder, anything you could decide yourself, and wording nitpicks. If nothing important
> is left, say "nothing important left".

Sort its questions into three piles:
- **Answered already** by the conversation or the records -> put the answer in the doc.
- **Minor** (a sensible builder could settle it without changing what gets built) -> settle it, mark it as
  your call.
- **The owner's** (only they can answer, and the answer changes the build) -> one message, most important
  first.

Tell the owner up front that a reader checks the doc first and you may return once with a few questions.
That is the only question round the check produces. With no agent available, read the doc as that builder
yourself and say so.

## Scope creep signs

Requirements added after approval; "small" additions piling up; "while we are at it" work no user asked for;
additions with nothing removed. The answer: every addition names what it displaces or goes to the parking lot
(rule:parking-lot); the doc is checked against its own intent before the plan starts.
