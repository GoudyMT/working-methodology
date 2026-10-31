# Forms and Field Errors

Load at step 3 or 5 for any input, form, wizard or setting. Exact-entry fields (codes, keys, passphrases) and
any hurdle follow rule:design-for-human-error and the human-factor skill first. Error wording is in
[copy-and-labels.md](copy-and-labels.md); where an error appears outside a field is in [states.md](states.md).

Why: a form that scolds early, hides its labels or blocks its own button loses people who were trying to finish.

## Fewer fields

- **Ask only what this step needs;** anything that can wait is asked later, when it is used.
- **Merge and infer:** one Full name field unless a rule needs the split; a date range is one control; no
  "confirm email" or "confirm password" field - one field with a show toggle instead.
- **Infer only from what is already on the device** (locale, time zone, last choice) or from data the project
  is allowed to send. A postcode lookup that sends the entry to an outside service is a data-flow decision
  (rule:security-standards), not a form tweak.

## Labels, hints and placeholders

- **Every control has a visible label, bound to it** (`<label for>` + `id`, a wrapping `<label>`, or
  `aria-labelledby` on visible text). Radio and checkbox groups use `<fieldset>` + `<legend>`.
- **Placeholder = a format example only** (`name@example.com`, `MM/YY`). If it could be read aloud as the
  field's name, it is a label and belongs above the field. Placeholders vanish on typing and are often low
  contrast; lasting guidance goes in helper text.
- **Order:** label, field, helper text (constraints, why it is asked), then the error, which replaces the
  helper in the same slot. Helper and error are linked with `aria-describedby`.
- **Required** fields carry the `required` attribute and a visible mark; optional ones say "(optional)". Never
  color alone.
- **Floating labels** only if the label stays visible after focus and matches the accessible name.
- **Search** may use an accessible name without a visible label only at the narrowest width; wider, it shows a
  visible label or an icon plus visible text.
- Clicking the label focuses the field. Prefix and suffix marks sit inside the field's box and pass a click to
  the field; only search, clear and show-password marks are allowed inside a field.

## Validation timing

| Event | Untouched field | Touched, invalid | Touched, valid |
|---|---|---|---|
| typing | no check | clear the error, re-check | re-check |
| leaving the field | check -> touched | check | check |
| submit | mark all touched, check | focus the first failure | submit |

- **Never show an error while someone types in an untouched field.** No red border, no message, no
  `aria-invalid` until the first blur.
- **Once shown, an error clears on focus or the first corrective keystroke,** not on the next blur.
- One message per field, leading with the fix.

## Submit

- **Do not disable submit to signal invalid input.** It stays clickable; a click with problems marks every
  field, moves focus to the first failure, scrolls it into view, and (with 3 or more errors) announces the
  count once in a page-level alert ("3 fields need attention").
- **Do guard against a double submit** while a request is in flight: the button shows its busy state
  (`aria-busy`, a "Saving..." label or spinner, [states.md](states.md)) and ignores repeat presses.
- **Real `<form>` + `<button type="submit">`** so Enter submits from a single-line field. In a textarea, Enter
  is a new line; Ctrl+Enter (Cmd+Enter on Mac) submits, and the hint says so.
- **Server errors map to the same field slots** as client errors; all input is kept; focus goes to the first
  failed field.
- **Warn before leaving a form with unsaved changes,** unless a draft is kept (below).

## Field types and mobile keyboards

- Use the right `type` (`email`, `tel`, `url`, `number` only for real quantities, `search`, `date`) and
  `inputmode` for the keyboard (`numeric` for codes and card numbers).
- **`autocomplete` tokens** where autofill helps: `name`, `email`, `street-address`, `postal-code`,
  `organization`, `current-password`, `new-password`, `one-time-code`.
- **Turn off autocorrect, autocapitalize and spellcheck** on codes, keys, usernames, ids and exact-entry
  fields; leave them on for prose.
- **Inputs are at least 16px** on mobile, or iOS Safari zooms the page on focus.
- **Masks never fight the cursor or block paste:** accept what is typed, normalise on blur. Currency stores a
  number and formats on blur.
- **Segmented codes:** typing advances, Backspace on an empty cell goes back and clears, paste fills all cells;
  one real input behind the cells keeps the label wiring simple.
- **Autofocus** the first field when a dialog opens on a pointer device; not on touch, where it throws up the
  keyboard unasked.

## Defaults and drafts

- **No blank select when a default can be inferred.** Order: the person's saved choice, then their last choice
  here, then locale or time zone, then a safe fallback. The default shows as a visible selected value, never a
  hidden pre-fill.
- **Long or multi-step forms keep a draft** so a refresh, a back tap or a closed tab loses nothing: save on a
  debounce (300 ms for a short reply, 500-2000 ms for a long form, every step change in a wizard); restore on
  return with a quiet "Draft restored" line and a Discard action; focus the first empty required field.
- **Draft records carry** `{ data, updatedAt, schemaVersion }` under a stable key per form and scope; drop a
  draft when its schema version changes, on submit, on Discard, after 30 days, and on sign-out.
- **If a newer saved version exists,** ask which to keep; never overwrite silently.
- **Drafts follow the project's data boundary** (rule:security-standards). Never stored: passwords, keys,
  tokens, one-time codes, payment numbers, government ids. Those forms warn on leave instead of saving.
- **Time-limited steps** (a code that expires) pause their timer while the tab is hidden.

## Check

- [ ] Every control has a visible, bound label; placeholders are format examples only.
- [ ] No error before first blur; errors clear on first correction.
- [ ] Submit never disabled for validation; double submit guarded.
- [ ] Enter and Ctrl/Cmd+Enter submit as described.
- [ ] Mobile keyboards match the field; inputs 16px or more.
- [ ] Refresh mid-form restores the draft; sensitive fields are absent from storage.
