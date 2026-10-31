# Icons and Controls

Load at step 3 or 5 for buttons, icon buttons, toggles, checkboxes, toolbars, tooltips, menus and anything
tapped. Icon style (drawn, one stroke weight, no emoji) is in rule:craft-floor. Keys and focus are in
[keyboard-and-focus.md](keyboard-and-focus.md).

Why: a control people miss, cannot name or can only reach by hover is a control that does not exist for them.

## The element

- **A button is a `<button>`;** a link that goes somewhere is an `<a href>`. No click handlers on `div` or `span`.
- **Buttons default to `type="button"`;** only the form's real submit is `type="submit"`.
- **Disabled controls are rare** and always explain themselves nearby; for forms see
  [forms-and-errors.md](forms-and-errors.md).

## Hit area

- **Target 44 x 44 CSS px** for anything tapped (WCAG 2.5.5 and Apple's guideline; Android's Material uses 48).
  The legal floor is 24 x 24 (WCAG 2.2, 2.5.8), for dense pointer-only spots, never for primary actions.
- **The glyph is not the target.** Grow the hit area with padding or a centered `::before`/`::after` of
  44 x 44; the visible icon can stay 16-24px.
- **Hit areas never overlap.** Where two would, shrink the pseudo-element to the largest size that does not
  collide.
- **No dead zones:** the whole row of a checkbox or radio, label included, is the target (wrap both in the
  `<label>`).
- **Double-tap zoom** off on controls with `touch-action: manipulation`; custom pan or zoom surfaces use
  `touch-action: none`.

## Touch first, hover extra

- **Every action works without hover.** Row actions live in a visible control or a "more" menu, never only on
  hover.
- **Hover styles sit inside `@media (hover: hover) and (pointer: fine)`,** so a tap does not leave a stuck
  hover state on touch screens.
- **Feedback is never only on hover** (status, errors, the meaning of an icon).

## Icon buttons

- **Collapse a label to an icon only for conventional marks** in chrome: close, more, filter, export, view
  toggles, a cluster of related tools.
- **Keep the visible label for:** the page's primary action, destructive actions, any form submit, and any icon
  that is not instantly clear in this domain.
- **Once collapsed, all of these hold:**
  - an accessible name (`aria-label` or visually hidden text) matching the tooltip;
  - a real tooltip shown on hover **and** on keyboard focus; `title` alone fails (slow, invisible to touch and
    keyboard, no room for a shortcut);
  - tooltip text is the verb-first label the button would have had ("Export CSV", not "CSV");
  - the shortcut, if any, follows the label in the tooltip, platform-aware (Cmd on Mac, Ctrl elsewhere);
  - the control is square and meets the hit area above;
  - toggles expose state (`aria-pressed`), grouped under a labelled `role="group"`.
- **Decorative icons** next to text take `aria-hidden="true"`. An illustration built in code is either
  `aria-hidden` or `role="img"` with an `aria-label`; it is not selectable (`user-select: none`) and takes no
  pointer events.

## Tooltips and menus

- **Tooltips wait about 200 ms** before showing, so a passing pointer does not trigger them. Once one is open,
  others open at once with no animation (a "warm" state that clears after about 300 ms with none open).
- **Tooltips hold no task-critical information;** touch users may never see them.
- **Submenus forgive diagonal movement:** a safe triangle between the parent item and the submenu keeps it open
  while the pointer travels.
- **Menus and selects** have a visible, tappable trigger; the keys are in
  [keyboard-and-focus.md](keyboard-and-focus.md).

## States every control has

Default, hover (pointer only), focus-visible, active or pressed, disabled, loading where it starts work, and
selected where it toggles. Selection never changes font weight
([typography.md](typography.md)); loading never changes size ([states.md](states.md)).

## Check

- [ ] Every tapped control has a 44 x 44 target with no overlap.
- [ ] Nothing needs hover; hover styles are gated to fine pointers.
- [ ] Every icon-only button has a name, a hover-and-focus tooltip and a square target.
- [ ] Checkbox and radio rows are clickable end to end.
