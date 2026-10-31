# Motion and Reduced Motion

Load at step 3 or 5 whenever anything animates or transitions, including hover and press feedback. Which
surface type an overlay is comes from [surfaces-and-pages.md](surfaces-and-pages.md); this file says how it
moves.

Why: motion should show what changed and where it went; motion that decorates slows people down, and for some
it makes them ill.

## Should it move at all?

1. **Seen 100+ times a day** (a menu toggle, list navigation): no animation, or almost none.
2. **Started from the keyboard** (arrow keys, shortcuts, focus moves): never animate.
3. **A response to a person's action** (open, expand, confirm, enter or leave): animate briefly to show the change.
4. **Rare or first-time** (a one-off success): may be a little special.
5. **Unprompted motion** (on load, on scroll): almost never in an app. On a persuade surface, spend it on one
   orchestrated moment, not a fade-up on every section.

Elements already in their default state do not animate in on page load; only later state changes animate.

## Durations (tokens: 100, 150, 200, 300 ms)

| Element | Duration |
|---|---|
| Press, focus settle, small feedback | 100-150 ms |
| Tooltip, popover, dropdown, row highlight | 150-200 ms |
| Drawer, modal, larger surface | 200-300 ms |
| Route change in an app | instant, or an opacity fade up to 200 ms |

- **Stay under 300 ms in product UI.** A 180 ms select feels faster than a 400 ms one.
- **Snap to the tokens;** a design asking 250 ms takes 200 or 300.
- **Exit faster than enter** (enter 200, exit 150). Bigger or farther-travelling elements take the longer end.
- **Things that move together share timing and easing** (dialog and scrim, drawer and backdrop, tooltip and
  arrow).

## Easing

| Case | Curve |
|---|---|
| Entering or leaving | ease-out, e.g. `cubic-bezier(0.16, 1, 0.3, 1)` |
| Moving or morphing on screen | ease-in-out, e.g. `cubic-bezier(0.645, 0.045, 0.355, 1)` |
| Hover and color change | `ease` |
| Constant speed (a ticker, a hold-to-confirm fill) | `linear` |

- **Avoid ease-in for anything the person waits on;** its slow start delays the feedback. Built-in CSS curves
  are often too weak; a named custom curve per case is better.
- **No bounce, elastic, overshoot or "back" curves on product chrome** (buttons, dialogs, lists, toolbars).
- **Springs** only for drag and gestures that can change direction mid-motion; they keep velocity when
  interrupted. Bounce stays at 0.1-0.3 and only for drag-to-dismiss or a playful moment. A swipe dismisses on
  velocity, not only distance (the source's threshold: distance / time above about 0.1 px per ms).

## What may animate

- **Only `transform` and `opacity`** (plus `filter` for small blurs). Color and border color may transition when
  150 ms or less. Never `width`, `height`, `top`, `left`, `margin`, `padding` or `font-size`; use transforms and
  reserved space ([spacing-and-layout.md](spacing-and-layout.md)).
- **Never `transition: all`;** list the exact properties. (Tailwind's bare `transition` class is `all`.)
- **Transitions for interactive state** (hover, toggle, open and close): they retarget mid-way and reverse
  smoothly. **Keyframes** only for one-shot sequences.
- **`will-change`** only on `transform`, `opacity` or `filter`, only after seeing first-frame stutter (a 1px
  jump at the start or end), never `all`. Each one costs memory.
- **Blur under 20px,** worst on Safari; animating CSS custom properties high in a deep tree recalculates every
  descendant.
- **Do not drive per-frame motion through framework state;** let CSS run it, or write the style directly.
- **Pause loops that are off screen;** no endless decorative loops on static chrome (pulsing borders, spinning
  logos). Functional loops (indeterminate progress) are fine.

## Patterns that work

- **Appear from 0.95, not 0:** start at `scale(0.95)` with opacity 0; from `scale(0)` looks like it came from
  nowhere.
- **Grow from the trigger:** popovers and menus set `transform-origin` to the trigger's side.
- **Press feedback:** `scale(0.97)` on `:active`, as a transition so release mid-press returns smoothly; off for
  buttons where the motion would distract.
- **Hover that moves the element** animates a child, so the hover area stays still and does not flicker.
- **Exits are quieter than enters:** a small fixed move (about 12px) plus fade, not the full height.
- **Stagger** only on the first paint of a short list (10 items or fewer): at most 30 ms per item, 200 ms
  total, opacity only; or a few semantic groups (title, text, actions) about 100 ms apart on a persuade
  surface. Never on filter updates, typing or virtual lists.
- **Icon swaps** (play to pause, copy to copied) cross-fade with opacity and a slight scale instead of a hard
  toggle.
- **Escape is never blocked by an exit animation.** Handle the key at once; the visual exit may finish after
  focus has gone back ([keyboard-and-focus.md](keyboard-and-focus.md)).
- **Persuade surfaces:** no scroll hijacking, no parallax that is not 1:1 with scroll, no auto-advancing
  carousels; an intro animation plays once per session.

## Reduced motion

- **Every animation ships with a `prefers-reduced-motion: reduce` path:** an instant change, or an opacity fade
  of 150 ms or less. No translate, scale, parallax, zoom, bounce, staggered cascades, shimmer or autoplay;
  video and animations show a still frame and a play button.
- **Prefer a scoped override per component** to a global reset. Watch the media query's `change` event if the
  setting can flip while the app is open.
- **Meaning never rides on motion alone.** "Saved" is a word or icon, not just a flash; an error is text plus
  `aria-invalid`, not a shake; loading is `aria-busy` plus a label; new items get a label or a focus move.
- **Focus order is the same with motion off.**
- **Test both settings** before shipping anything that moves.

## Debugging feel

- Record the animation and step through it frame by frame when it "feels off".
- Review motion again on another day before calling it done; use the product daily to find the animation that
  gets tiring.

## Check

- [ ] Nothing keyboard-driven or high-frequency animates.
- [ ] Durations on the token scale, under 300 ms; exits faster.
- [ ] Only transform and opacity animate; no `transition: all`.
- [ ] Every animation has a reduced-motion path, and meaning survives with motion off.
- [ ] Escape and focus work during every enter and exit.
