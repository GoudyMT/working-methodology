# Typography

Load at step 3 (build) or step 5 (check) when a screen sets or changes type. The floor items (65-75 character
lines, space above a heading, tabular figures) live in rule:craft-floor; this file adds the numbers behind them.

Why: a small, fixed type system makes hierarchy come from size and space, not from piling on weights.

## The scale

- **Root 16px (1rem).** Three fixed tiers: body 1rem (16px), secondary 0.875rem (14px), meta 0.75rem (12px).
- **No text below 12px**, ever. Never shrink type to make a table or row fit; wrap, truncate or scroll a region.
- **Primary content is body or secondary, never meta.** Table cells, list rows, card text and form values are
  14px or 16px. 12px is for timestamps, legal lines, keyboard hints and helper text only. Check the computed
  size on the real element, not the class name.
- **Headings follow one modular scale:** `size(step) = 1rem x ratio^step`, rounded to 2 decimals in rem.
  - Ratio 1.125 (major second) for dense, data-heavy app screens: 18, 20.3, 22.8, 25.6, 28.8px.
  - Ratio 1.2 (minor third) for reading and persuading surfaces: 19.2, 23, 27.6, 33.2, 39.8px.
  - Pick one ratio per product. Map: H4 = step 1, H3 = step 2, H2 = step 3, H1 = step 4-5.
- **At most 4-5 distinct sizes on one screen** (meta, secondary, body, subheading, heading).

## Weights

- **Three weights app-wide**, by default 400 (body), 500 (interactive labels), 600 (headings).
- Above 600 only when the chosen face looks thin at 600; never above 700. Emphasis beyond that comes from size,
  color or space.
- **Weights are tokens** (`--font-regular` and so on), so one change moves the whole app.
- **Never change weight on hover or selected state.** The text reflows and neighbours shift. Mark selection
  with color, an underline or an indicator instead.

## Line height (unitless, so it scales with size)

| Role | Size | Line height |
|---|---|---|
| Display | >= 2rem | 1.1-1.15 |
| Heading | 1.25-2rem | 1.2-1.25 |
| Body | 1rem | 1.5-1.6 |
| Secondary | 0.875rem | 1.5-1.55 |
| Meta | 0.75rem | 1.35-1.4 |

Reject any line height below 1.1, and above 1.6 on body text. Serif body text takes the top of the body range.

## Spacing and wrapping

- **Letter spacing:** default for body. Tighten only display sizes >= 2rem, by -0.01em to -0.02em. Small text
  may loosen slightly. With a variable font and negative tracking, check a screenshot for doubled or smeared
  last letters.
- **`text-wrap: balance` on headings** and short blocks (browsers balance only about 6 lines in Chromium, 10 in
  Firefox). **`text-wrap: pretty` on body paragraphs** to avoid a lone last word. Neither on code.
- **Truncate last.** Ellipsis or `line-clamp` only after layout options run out; the full text stays reachable
  (a detail view, a title attribute is not enough for touch).
- **Do not nest em-based sizes more than one level.** Flatten to rem tokens.
- **Mixed sizes in one row align on the baseline** (`align-items: baseline`), not the box center.

## Numbers

- **Tabular figures** (`font-variant-numeric: tabular-nums`) for counters, timers, prices that change, table
  columns and anything that lines up. Not for phone numbers, postcodes, version strings or static display
  numbers. Some faces change the look of "1" in tabular mode; check the face.

## Choosing faces

- **One family for the app UI;** a second only for a persuade surface, and then clearly different from the first.
- **Choose deliberately** from the subject and audience, not the face you would reach for on any project. The
  owner locks the choice (rule:visual-design-collaboration).
- **Fonts are a payload:** subset to the characters and languages you use; preload the one or two files above
  the fold so text does not jump when the font arrives. An offline app ships its fonts in the cache, never from
  a third-party font host at run time (rule:security-standards: no third-party requests the project did not
  allow).
- `-webkit-font-smoothing: antialiased` on the root is optional. It changes macOS only; apply it once at the
  root or not at all.

## Check

- [ ] Every computed font size maps to the three tiers or a scale step; none below 12px.
- [ ] Primary content is 14px or 16px.
- [ ] Three weights or fewer; no weight change on hover or selection.
- [ ] Headings 1.1-1.25 line height; body 1.5-1.6.
- [ ] Changing numbers use tabular figures.
- [ ] Real-length text at the narrowest width (rule:visual-design-collaboration) wraps without overflow.
