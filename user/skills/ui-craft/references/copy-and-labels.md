# Copy and Labels

Load at step 3 or 5 whenever a screen carries words: buttons, links, menus, headings, errors, empty states,
confirmations, tooltips, onboarding. Copy that promises a protection follows the human-factor skill (no claim
the design does not keep); repeated boilerplate is refused by rule:visual-design-collaboration. Any number,
date or official link in shown text passes rule:fact-check.

Why: in an interface the words are the signposts; vague or inconsistent words make people guess.

## Principles

- **Plain and specific.** Name things the way the person thinks of them, not how the system is built ("your
  saved steps", not "local records"). Clear beats clever.
- **Fewest words that carry the whole meaning,** and each element does one job.
- **One term per thing, everywhere.** The button that says "Publish" leads to a toast that says "Published".
  Keep a short glossary when a product has more than a handful of nouns.
- **Sentence case** for buttons, headings and labels; title case only for proper nouns. Never all caps on a
  button.
- **Active voice, present tense.** Say what happens, not what the system "will attempt".
- **Write the real copy at design time.** Placeholder copy hides overflow and makes the design feel templated;
  test real-length text at the narrowest width.

## Actions (buttons, links, menu items)

- **Start with a verb; add the object when it disambiguates:** "Export CSV", "Add a step", "Delete plan".
  1-3 words where possible; longer only when the object is needed for safety.
- **Ban on sight:** OK, Submit, Proceed, Yes / No on action buttons, Click here, and "Learn more" as the only
  action. "Continue" / "Next" only inside a step flow whose next step is already shown.
- **Save, Create, Publish:**

| Situation | Label |
|---|---|
| Editing something already saved | Save changes |
| Making something new | Create <thing> |
| Kept but not public yet | Save draft, then Publish <thing> |
| Auto-save | "Saved" as status text, not a button |

- **Delete vs Remove:** Delete = gone for good. Remove = taken out of a list, still exists, can come back.
- **Leaving work:** Cancel or Discard changes; "Close" only for a pure overlay with nothing to lose.
- **Menu items** say the action: "View details", "Edit settings", "Copy link" - not a bare noun.
- **Retry:** "Try again" or "Retry upload".
- A button that has a keyboard shortcut shows it in its tooltip ([keyboard-and-focus.md](keyboard-and-focus.md)).

## Field labels

- **Nouns or short noun phrases:** "Email", "Separation date" - not "What's your email?".
- Lasting instructions go in helper text below the field, never in the placeholder
  ([forms-and-errors.md](forms-and-errors.md)).

## Errors

- **Never blame the person.** Not "You entered an invalid date"; instead "Enter a date like 2027-04-30". Use a
  neutral subject: "This code has expired", "We couldn't save your changes".
- **Under two sentences, three parts:** what happened, why it matters to their work, what to do now. Lead with
  the recovery when it is obvious ("Check your connection and try again").
- **Field errors are format hints:** "Use at least 8 characters", not "Invalid input".
- **For possible data loss, say what was kept and what was not.**
- **No apologies, no vagueness, no codes** in the message; codes go behind Copy error details
  ([states.md](states.md)).

## Confirmations

- **Title names the action and the exact thing:** `Delete plan "Spring move"?` - never "Are you sure?".
- **Body: 1-3 sentences** on what goes, how much (counts), and whether it can be undone ("This can't be
  undone").
- **Buttons repeat the verb:** "Delete plan" and "Cancel"; never OK / Cancel or Yes / No.
- The entity name matches the screen exactly (case and punctuation).

## Empty, loading, success

- **Empty:** what belongs here, why fill it, one action ([states.md](states.md) holds the variants).
- **Loading:** a verb-ing label ("Saving...", "Loading your plan...") that sets expectation; for long waits,
  say roughly how long or what is happening.
- **Success:** short and plain ("Saved", "Link copied"); celebrate rarely and briefly.

## Tooltips and onboarding

- **Tooltips** add what the label cannot; never repeat the obvious, never hold information needed to finish
  the task (touch has no hover).
- **Onboarding** introduces one idea at a time, at the moment it is needed.

## Tone by moment

| Moment | Tone |
|---|---|
| Error | Calm, helpful, no blame |
| Warning | Clear and actionable |
| Success | Brief, pleased, not loud |
| Neutral | Informative, concise |

## Shown characters and translation

- Curly quotes, the ellipsis and the like in shown text follow the project's string convention; where source
  files must stay ASCII, insert them by character code or entity rather than typing them.
- Leave room for longer text (translations, large text settings); avoid idioms and text baked into images.

## Copy proposal format

When asked for copy, give: the recommended line per element; 2-3 alternatives in a table (copy, tone, best
for); one line of why; any translation notes. The owner picks (rule:visual-design-collaboration covers copy
no lock covers).

## Check

- [ ] Every action label starts with a verb; none on the ban list.
- [ ] The same thing has the same name across the flow.
- [ ] Errors: no blame, under two sentences, a next step, no codes.
- [ ] Confirmations name the thing and repeat the verb on the button.
- [ ] Sentence case throughout.
