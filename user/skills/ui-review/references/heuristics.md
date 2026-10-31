# Heuristic prompts and the reading pass

Used in step 3 (opinion first). Nielsen's ten heuristics (Nielsen and Molich 1990; Nielsen 1994) have no pass or
fail number, so a finding grounded in one argues its case: what the person sees, what they will do wrong, why.

## First impression (two seconds, per screen)

- What does the eye land on first? Is that the thing the surface's job needs first?
- Is the screen's purpose clear without reading the body text?
- Is there one primary action, or do two compete for it?

## The ten heuristics, with prompts

Ask each prompt on every screen in scope. A "no" is a candidate finding; name the element.

**H1 Visibility of system status**
- After each action, is there visible proof it worked (a change on screen, a message, a moved focus)?
- A wait over about 400 ms: is it covered by a skeleton or a progress message that says what is loading, not a
  bare spinner? Can a long wait be cancelled?
- If the scripts failed to load, would the person know, or does the page look fine and do nothing? A missing
  error boundary is usually a bigger finding than the flake under it.
- Is async status announced to a screen reader too (WCAG 4.1.3)?

**H2 Match with the real world**
- Are labels the words the person would use or search for, not internal or code names?
- Does the order of steps match the order of the real task?
- Do numbers, dates and units read the way the audience expects (an unambiguous date, grouped thousands)?

**H3 User control and freedom**
- Can every step be left, undone or gone back from? Does the browser Back button do what the person expects?
- If the person leaves mid-way (tab switch, reload, crash), is their input kept, and can they resume?
- Can an overlay be closed with Escape and with a visible control?

**H4 Consistency and standards**
- Does the same class of action use the same pattern as the rest of the app (inline-expand vs modal -
  rule:visual-design-collaboration)?
- One thing, one name: the same feature or object is called the same word on every screen and in every locale.
- Do similar controls look alike? Count the treatments of one control role (see the drift counts below).
- Mixed Title Case and sentence case on one screen is drift.

**H5 Error prevention**
- Do inputs constrain what they can (type, `inputmode`, `min` / `max`, `maxlength`, a picker) rather than reject
  after submit?
- Is a destructive action confirmed, naming the thing and the verb ("Delete 3 files", not "Are you sure?"), and
  can it be undone after?
- A submit button disabled until the form is valid hides WHICH field is wrong: keep it enabled and show
  field-level errors on submit.
- Does validation fire on leaving a field (blur) and clear as soon as the person edits it, never on each key?

**H6 Recognition rather than recall**
- Are the options shown, not remembered from an earlier screen?
- Does a long list (about 12 options or more) have search, grouping or a good default?
- Does the person ever have to copy a value from one screen to type it on another?

**H7 Flexibility and efficiency**
- Trace the product's central promise (the thing onboarding or the headline says it does) to its control. Count
  the taps. A promise with no entry point on the main screen is often the top finding.
- Is the core action buried more than two levels from where it is promised?
- Do repeat users have a fast path (keyboard, remembered choice) without slowing the first-timer?

**H8 Aesthetic and minimalist design**
- Does each element earn its place? Look for duplicate entries, a section header repeating its own children,
  boilerplate copy that already appears elsewhere.
- Does emphasis carry rank? If more than about 40% of the text is semibold or heavier, weight has stopped
  meaning anything.
- Check the refusal list in rule:craft-floor.

**H9 Recognize, diagnose and recover from errors**
- Does each error say what happened and what to do next, in plain words, without blaming the person?
- Is the error shown next to the field, in text, not color alone (WCAG 3.3.1, 1.4.1)?
- Does every empty state carry its next step? An empty state with no action is a dead end, and new users meet
  these first.
- Exact-entry fields: see rule:design-for-human-error.

**H10 Help and documentation**
- Where a meaning is not obvious, is there helper text at the point of need?
- Is a placeholder doing the job of a label (it vanishes on typing)?
- Is help findable in the same place on every screen (WCAG 3.2.6)?

## The reading pass

Extract the full visible text of each screen and read it as a skeptical new user. Tools cannot see meaning.

- **Placeholder copy that looks real:** "Feature test", "Test user", a lone lowercase entry among capitalized
  ones, a description that describes nothing. Lorem ipsum is the easy case.
- **Claims against the product:** every promise on screen (a feature, a limit, a guarantee) exists in the
  product. A promise the product cannot keep is P0 on a page that asks for trust, money or data.
- **Contradictions:** two numbers for one thing on one screen; a label that says one thing and a link that goes
  elsewhere; a higher tier with a lower limit. Find the source value (below) before writing it up.
- **Concatenated strings and hardcoded plurals:** "1 items" is the same defect class a second locale will expose.

### Go to the source of a value

For a contradiction or a suspicious number, read the value where the page got it (the response the page already
fetched, the data file, the config). Stay read-only: GET requests the page made, never a write.

- Rendered value matches the source -> the data is wrong (content or backend).
- Rendered value differs from the source -> the rendering is wrong (front-end).
- The source holds something the UI never shows -> a missing feature, often the cheapest fix.

Report the source value beside the rendered one; that pair is the finding.

## Law-based counts (prompts, not verdicts)

These give a number to ask a question with. A high count is right for a dense tool and wrong for onboarding;
say which this is.

| Count | How | Ask the question when |
|---|---|---|
| Hick index | `log2(n + 1)` for interactive targets on the first screen, per nav group, per form, per select | report the index, never seconds (the constant is per person) |
| Fitts index | `log2(D / W + 1)`; on touch, D from the thumb's rest at the bottom of the screen | the primary action sits in the top part of a phone screen, or is small and far |
| Chunking | items in one flat group | more than about 9 with no subgroups (Miller's 7 +/- 2 is about memory span, not a menu limit) |
| Type sizes | distinct computed font sizes on the page | more than about 10: there is no type scale |
| Spacing | distinct margin and gap values | more than about 14 |
| Radii | distinct border-radius values | more than about 6 |
| Text colors | distinct text colors | more than about 8 |
| Small text | text under 12 px | any, outside legal small print |
| Top band | what fills the first 120 px of a phone screen | it holds chrome, not the task |

These thresholds are one source's house numbers, not standards; present them as judgment.
