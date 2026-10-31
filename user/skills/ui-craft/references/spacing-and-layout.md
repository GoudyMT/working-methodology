# Spacing and Layout

Load at step 3 or 5 when a screen sets gaps, padding, alignment, radius, stacking or anything that can shift.
Line length and heading space are in rule:craft-floor; widths and overflow are in [viewports.md](viewports.md).

Why: a predictable rhythm reads as calm, and a layout that never jumps reads as solid.

## Rhythm

- **8px grid for structure, 4px for detail.** Section gaps, card padding, stack heights and gutters are
  multiples of 8. Icon padding, inline gaps and label offsets are multiples of 4. Odd values (13px, 22px) are
  wrong unless they are a documented optical correction (below).
- **One short token set:** 4, 8, 12, 16, 24, 32, 48, 64. Big jumps mark section breaks; small steps stay
  inside one component.
- **Group by distance:** related controls 4-8px apart, unrelated groups 16-24px apart, sections 32px or more.
  When unsure, add space between sections, not between items inside one.
- **A shared container makes a group obvious;** use it when distance alone is not enough. A container is not
  decoration: rule:craft-floor refuses cards inside cards.
- **Prose sits in a capped column** (`max-width` in `ch`); wide screens get a narrower inner column, never
  edge-to-edge body text.

## Optical alignment

Geometric centering is a starting point; fix what still looks off, and fix it in the smallest place.

- **Icon beside text centers on the cap height, not the line box.**
  `iconOffsetY = (fontSize x capRatio - iconSize) / 2`, applied as `translateY` on the icon wrapper, rounded to
  0.5px. capRatio is about 0.70 for system UI faces (Inter 0.72, Roboto 0.73, IBM Plex Sans 0.71); measure a
  custom face. Example: 14px text, 16px icon -> (9.8 - 16) / 2 = -3.1 -> `translateY(-3px)`.
- **Text plus trailing icon button:** icon side padding = text side padding - 2px (16px / 14px).
- **Play triangles** shift right about 2px. **Uneven icons** (stars, carets) are best fixed in the SVG itself,
  so no component needs a nudge.
- Nudges of 1-2px are for icons, chevrons and marks only, never for layout gaps.
- Check at 2x zoom: the icon's visual center falls between cap height and x-height.

## Radius

- **Nested rounded shapes are concentric:** outer radius = inner radius + padding between them. When that
  padding is over 24px, the layers read as separate surfaces; pick each radius on its own.
- **One radius scale by hierarchy,** not one value on everything. App controls usually 6-8px. Radius 24px or
  more on inputs, tables and buttons together reads as generated.

## No layout shift

Nothing a person did not move may move.

- **Reserve space** for anything that arrives late: fixed sizes or `aspect-ratio` on images and video, skeletons
  that match the final geometry, room for badges and counts.
- **Swaps keep the box:** an inline edit, a loading button or a toggled icon takes the same width and height as
  what it replaces. Check: a neighbour's `getBoundingClientRect()` top and left are equal before and after.
- **Overlays do not push content:** popovers and drawers are fixed or absolutely positioned.
- **Refresh does not flash:** an interactive component renders its real initial state on first paint (state
  restored before render, server render matched), not a default that then snaps.
- Weight changes and late fonts also shift text: see [typography.md](typography.md).

## Stacking order

- **A fixed z-index scale,** never 9999: flow 0, sticky local headers 10, dropdowns and tooltips 100, drawers
  200, modals 300, toasts 400. The gaps leave room to insert a layer.
- **Prefer a new stacking context** (`isolation: isolate`) on a component over raising its z-index.

## Edges and scroll

- **Safe areas:** fixed headers, footers and bottom bars pad with `env(safe-area-inset-*)` so a notch or home
  bar never covers a control (needs `viewport-fit=cover`).
- **Anchor targets** set `scroll-margin-top` to the sticky header height, so a jump does not hide the heading.
- **No fade mask on a scrolling list;** it hides content the person is looking for. Fades (prefer `mask-image`
  over an overlaid gradient) are for static, decorative edges.
- **Never restyle the page scrollbar.** Small inner regions (a code block) may.
- **Decorative layers** take `pointer-events: none` so they never steal a tap from a control under them.

## Check

- [ ] Every gap and padding is on the 4/8 grid, or is a documented optical fix.
- [ ] Nested radii are concentric.
- [ ] Icons beside text are cap-height aligned.
- [ ] Loading, editing and toggling move no neighbour (measured).
- [ ] z-index values come from the scale.
