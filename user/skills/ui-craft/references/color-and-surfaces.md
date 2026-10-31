# Color and Surfaces

Load at step 2 (direction) or step 3 when a screen picks colors, surfaces, borders, shadows or a dark theme.
Contrast is gated by rule:visual-design-collaboration (the rendered pair, fixed at the token); secondary text on
a colored surface and the refuse list (glass, gradient text, side stripes) are in rule:craft-floor.

Why: depth that comes from quiet borders and one accent tells the eye where to act; loud fills and heavy
shadows tell it nothing.

## Color budget (60-30-10)

| Share of the viewport | Bucket | Allowed |
|---|---|---|
| ~60% | Canvas (L0): page background, empty regions | Neutrals only |
| ~30% | Structure (L1): sidebars, panels, lists, tables, nav | Neutral steps, no accent fill |
| ~10% | Accent: primary buttons, active state, key links, focus | One accent hue family |

- **Measure on a screenshot** of a typical viewport, by area, not by counting tokens. Structure near 0% (bare
  text on the canvas) fails; accent well over 10% fails.
- **Structure differs from canvas by one neutral step,** never a new hue.
- **Status colors** (error, warning, success) are separate from the accent and never the only signal: a word or
  an icon carries the meaning too (forced colors and color-blind readers; rule:diagrams says the same of figures).
- **Tokens, not values:** every color is a named token. Dark mode flips the tokens (a numbered neutral scale,
  1 = lightest in light mode, swapped in dark), not per-component overrides.

## Surface levels

| Level | Role | Border (alpha of the text color) | Shadow ceiling (light) |
|---|---|---|---|
| L0 | Canvas | none | none |
| L1 | Panels, lists, tables, boards, sidebars | 1px at 6-10% | `0 1px 2px` at 0.04, optional |
| L2 | Floating: dropdowns, popovers, sticky subheaders | 1px at 8-12% | `0 4px 12px` at 0.06 |
| L3 | Overlay: modals, drawers, command menu, with a scrim | 1px at 10-14% | `0 8px 24px` at 0.08 |

- **Pick the level:** sits on the canvas -> L1. Floats while the page stays usable -> L2. Blocks the main task ->
  L3 with a scrim (black at 50-70%, never accent-tinted).
- **A list, table or board is always L1:** a 1px border, or a one-step background shift plus hairline row
  dividers. Text on the bare canvas with neither fails. A "few borders" style removes decorative card chrome,
  never a table's frame.
- **Border first, shadow second.** Every raised surface has its border before any shadow. Shadow color alpha
  stays under 0.08 in light mode, with large blur, small spread and a 1-4px y-offset. Hover deepens the border a
  little before it adds shadow.
- **Shadows are dropped in forced-colors mode,** so a shadow can never be the only edge of a control or surface.
  A `0 0 0 1px` shadow ring may draw a hairline on varied backgrounds only when a real border or outline still
  shows in forced colors.
- **Banned:** hard sticker shadows (alpha 0.2 or more, tight blur, offset 8px or more), neon glow borders,
  stacked shadow layers summing over 0.08, shadow plus gradient plus blur on one component (pick one depth cue).

## Dark mode

- L0 to L1 step: +4-8% lightness. Borders 10-14% alpha (low ones vanish on dark).
- Prefer no outer shadow; use a top inset highlight, `inset 0 1px 0` white at 0.04-0.08, for edge light.
- Re-run the contrast gate in dark mode; tints that pass on white often fail on near-black.
- Switching themes disables transitions for that frame, so colors snap instead of animating every element.

## Images and media

- A 1px inset outline at about 10% alpha (black in light, white in dark, `outline-offset: -1px`) gives images
  a consistent edge without changing their size.
- Autoplay video is muted and `playsinline`; with reduced motion it shows a play button instead
  ([motion.md](motion.md)).

## Gradients

- Primary buttons are a solid fill, or one hue with at most a 10% lightness shift. Multi-hue, conic and
  rainbow fills on controls are refused.
- Where a gradient is chosen, use an eased stop curve to avoid visible banding.

## Check

- [ ] Screenshot estimate: canvas ~60, structure ~30, accent ~10.
- [ ] Every list, table and board has an L1 frame.
- [ ] Every raised surface has a border; light shadows under 0.08 alpha.
- [ ] Edges and state still show in forced colors.
- [ ] Dark mode uses its own token values and passes contrast.
