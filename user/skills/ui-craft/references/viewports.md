# Viewports

Load at step 3 or 5 for any page, layout, navigation, table or overlay. The widths, themes and engines a
project checks are its adapter row A21 (rule:visual-design-collaboration); this file says what must hold at
each width.

Why: a layout proven only on a desktop breaks in the hand of the person who needed it most.

## Widths

| Name | Width | Job |
|---|---|---|
| narrow | the project's narrowest (A21); 320px if unset | Phone. Navigation sits behind a menu button. |
| medium | 768px | Optional point where two columns become one. Not a third design. |
| wide | 1280px | Desktop proof; caps the main content width. |

- 320px is the width WCAG's reflow rule (1.4.10) tests; a 375px phone is common but not the smallest.
- **Three names only.** Do not add a fourth breakpoint for one screen.
- Query narrow as `@media (max-width: 767.98px)` so 768 lands in medium.

## What must hold

- **No page-level sideways scroll** at the narrowest width or at 1280: `document.documentElement.scrollWidth`
  is not larger than `clientWidth`. One inner region (a wide table, a board, a comparison grid) may scroll
  sideways on its own; `overflow-x` on `html` or `body` fails.
- **Never shrink text to fit** (12px floor, [typography.md](typography.md)). Wrap, stack, or scroll one region.
- **Prefer wrap and stack** over a second scrollbar.
- **Cap the content, not the app.** `html`, `body`, the app shell, header and sidebar span the full width. Only
  the main content (`main` or the page body) takes `max-width` (1280px) and is centered. Never lock a shell,
  card or root to a fixed pixel width of 768 or more without a wrap or inner-scroll plan; never cap each widget.
- **Navigation collapses on narrow.** A persistent sidebar (200px or wider) on a phone fails; a menu button
  opens the same destinations.
- **Every action is reachable by tap** at every width ([icons-and-controls.md](icons-and-controls.md): hit
  areas, no hover-only paths).
- **Drawers go full height** on narrow and at most `min(480px, 100vw)` wide elsewhere.
- **Fixed bars respect safe areas** ([spacing-and-layout.md](spacing-and-layout.md)).
- **Each page pattern has a narrow rule** ([surfaces-and-pages.md](surfaces-and-pages.md)): tab rows become a
  scroll-snap row or a select; settings navigation becomes a top select; boards snap-scroll their columns; split
  panes become list then full detail.

## Prove it

- Resize or emulate the narrowest width and 1280, with real-length text (rule:visual-design-collaboration).
- Measure `scrollWidth <= clientWidth` at both widths; record the numbers.
- With no browser available, mark the width check **unproven**, never passed.

## Check

- [ ] No page-level sideways scroll at the narrowest width and at 1280 (measured).
- [ ] Shell full width; only main content capped.
- [ ] Navigation collapses to a menu on narrow.
- [ ] No text under 12px to make something fit.
