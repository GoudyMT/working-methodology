# Front-end and performance checks

Used in step 5, after the accessibility checks. Read the files the change touches and two or three neighboring
components first, so "consistent" means consistent with THIS codebase. Framework-specific items are labelled.

## State coverage (one table per changed component)

| Element | Hover | Focus | Active | Disabled | Loading | Empty | Error | Success | Each theme |
|---|---|---|---|---|---|---|---|---|---|

- Fill each cell: present, missing, or n/a. rule:craft-floor names the floor; this table is how to record it.
- A screenshot shows one state. Whether a `:disabled` or `:active` rule exists at all is read from the
  stylesheet: zero `:active` rules means no press feedback anywhere.
- Loading and empty are the states plans forget most; long and missing data (a 3-line name, a null field) are
  next.

## Tokens and visual consistency

- Colors, spacing, radii and type come from the project's tokens, not raw values. A new color is added as a token
  in every theme, not inlined. Use the drift counts in heuristics.md to put a number on it.
- New components match their neighbors' radius, spacing and density.
- Long text has a plan: wrap, truncate with the full value reachable, or a set line count. Check at the
  narrowest width with real-length text.
- Icons come from the project's icon set; a decorative icon is hidden from screen readers, a meaningful one has a
  name.

## Motion

- Animate only `transform` and `opacity` (they skip layout and paint).
- Keep UI transitions short, about 100-300 ms; enter and exit ease out.
- Every animation has a `prefers-reduced-motion` path; essential motion (progress) gets a static cue.

## Code patterns that break screens

Framework-neutral unless labelled.

- **Listener and timer cleanup:** every listener, subscription, observer or interval added when a component
  mounts is removed when it unmounts. A component that remounts without cleanup stacks listeners.
- **Derived, not synced:** a value computed from other state is derived (Svelte 5 `$derived`, React `useMemo`),
  not copied into state by an effect. An effect reacting to a change that an event handler caused is the same
  smell: put the logic in the handler.
- **Stale capture:** a long-lived callback (timeout, listener) reads current state when it fires, not a value
  captured when it was made.
- **List keys:** stable and unique, never the array index for a list that reorders, inserts or deletes (Svelte
  `{#each}` keys, React `key`).
- **Async races:** two requests for the same view can resolve out of order; the later answer must not be
  overwritten by the earlier one. A submit is guarded against a double tap.
- **Dynamic utility classes** (Tailwind): a class built from a template string is not seen at build time; use
  whole static class names or an inline style for a truly dynamic value.
- **Types at the edge:** data from outside (network, storage, files) is validated where it enters; no implicit
  `any` past that point (TypeScript).

## Performance

Measure on the production build, never the dev server. Throttle to a mid-range phone profile for the numbers.

| Measure | Good | Where it comes from |
|---|---|---|
| Largest Contentful Paint | 2.5 s or less | Core Web Vitals (web.dev), 75th percentile of loads |
| Interaction to Next Paint | 200 ms or less | Core Web Vitals |
| Cumulative Layout Shift | 0.1 or less | Core Web Vitals |
| Response to an action feels immediate | under about 400 ms, else show progress | Doherty threshold |
| Long tasks on the main thread | none over 50 ms during an interaction | browser long-task API |

Prompts:
- **Startup path:** does the change add work before first paint? Can a heavy import load only when its feature
  is used?
- **Bundle:** does it pull a whole package or a barrel file for one function? Check against the project's size
  budgets (rule:size-budgets where the project has one).
- **Hot path:** what runs on every keystroke, scroll or pointer move? A filter or search over a large set is
  debounced (about 200-300 ms).
- **Requests:** independent requests run in parallel, not one after another; the same data is not fetched twice;
  nothing polls where an event exists.
- **Growth over a long session:** does any list, cache or history grow without a cap or eviction? Is a large
  object (file contents, a DOM node) held after it is needed?
- **Streaming:** a streamed response is parsed as it arrives, not re-joined into one growing string.
- **Layout shift:** images and late content reserve their space; fonts do not reflow the page on load.
- **Offline-first apps:** the screen works from cache with no network, and says so; a failed sync is visible
  (H1).

A number in the report states the build, the device or emulation profile and the run count. A single run is a
claim about the instrument (rule:instruments-and-evals); give the median of at least three.
