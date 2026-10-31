# States: Empty, Loading, Error, Done

Load at step 3 or 5 for every view that fetches, filters, saves or can be empty. rule:craft-floor requires each
state to exist; this file says what each one contains. Wording rules are in [copy-and-labels.md](copy-and-labels.md).

Why: the states between "nothing" and "everything worked" are where people decide whether to trust the product.

## Pick the state from the data

`loading -> populated | first-use empty | filtered empty | no-access empty | error`. Never render a blank content
area: every branch has a designed state. A view whose parts load on their own (tabs, charts) owns its own
loading, empty and error states per part.

## Empty

- **Same footprint as the filled view.** The frame stays: table headers, the list frame, the calendar grid, the
  search and filter bar. The empty message sits inside it; the content area never shrinks to a small box.
- **First use (nothing yet):** a heading naming what belongs here ("No saved steps yet"), one sentence on why
  filling it helps, and one verb-first action that starts it ("Add a step"). Optional: a second link (an
  example, how it works) or a 2-3 step hint list.
- **Filtered to nothing:** a heading saying nothing matches ("No steps match 'housing'"), a one-line suggestion,
  and a **Clear all filters** action that resets every filter and the search in one press. Add a create action
  only if it still makes sense. Do not repeat onboarding here.
- **No access:** say there is nothing to show and why, without blame; offer how to get access if there is one.
  Never show a create action the person cannot use.
- **No illustrated people,** mascots or empty-box art. Text, the action, and at most one small monochrome icon.
- A bare "No data" or an empty table with no message is a dead end and fails.

## Loading (by expected wait)

| Wait | Show |
|---|---|
| under 100 ms | nothing - a loader that flashes feels slower |
| 100 ms - 1 s | inline feedback on the control that was pressed |
| over 1 s, content | a skeleton matching the final layout |
| over 5 s | skeleton plus a progress hint; consider showing parts as they arrive |

- **Wait 100 ms before mounting any loader,** and clear the timer on completion, so fast results never flash.
- **Inline (100 ms - 1 s):** the pressed button keeps its size, gets `aria-busy="true"`, ignores repeat presses,
  and shows a small spinner or a verb-ing label ("Saving..."). Nothing else on the page is blocked.
- **Skeletons mirror the real geometry:** same columns, row heights, card sizes and gaps, so nothing jumps when
  content lands. One skeleton for a container, not a spinner per cell. Shimmer, if any: 1.2-1.8 s period, a
  subtle opacity change; static blocks under reduced motion.
- **No full-page spinner for content.** Allowed only for the first app boot before any layout exists (under
  3 s), or a long blocking job the person started, with a Cancel.
- **A faster spinner feels faster.** Keep indeterminate loops brisk and pause any loop that is off screen.
- Test on a throttled network and CPU (for example Slow 3G, 4x CPU) and confirm cached results show no flash.

## Errors (where they appear)

| Surface | Use for | Recovery |
|---|---|---|
| Inline, at the field | Fixable input ([forms-and-errors.md](forms-and-errors.md)) | Correct the entry |
| Toast | A passing failure that does not block | A retry action, or dismiss |
| Banner, top of a region | One section blocked, the rest usable | A primary recovery action |
| Full view | The whole view cannot work | Try again, go back, or copy details |

- **Error toasts with an action stay until dismissed;** success toasts last 4-8 s and never carry the only copy
  of something important. Toasts sit in a live region (`role="status"`, or `role="alert"` for errors).
- **Technical details never appear in the message.** No stack traces, raw status codes or database text. Offer
  **Copy error details**: a reference id, time, route and a cleaned code, and nothing from the person's own
  data (rule:security-standards).
- **Say what was kept.** After a failed save or a lost connection, state whether the input is safe ("Your
  changes are kept on this device").
- **Errors and feedback stay visible;** never only on hover or behind a click.

## Done

- Success is confirmed in words or a changed control ("Saved"), not by motion alone
  ([motion.md](motion.md)).
- An auto-saving view shows a quiet status line ("Saved"), not a button.
- A soft delete may offer Undo in a toast; an irreversible one needs the confirm dialog
  ([surfaces-and-pages.md](surfaces-and-pages.md)) first.

## Check

- [ ] Each view has loading, populated, empty (all that apply) and error states, built and seen.
- [ ] Empty states keep the frame and offer an action; filtered empties offer Clear all filters.
- [ ] No loader under 100 ms; skeletons match the layout; no full-page spinner for content.
- [ ] Error copy is plain, technical detail is behind Copy error details, and no personal data is in it.
