---
paths:
  - "**/*.{svelte,tsx,jsx,vue,css,html}"
---
<!-- Written by kit.mjs build from rules/design-and-ux.md. Edit the source in the kit and run build; a change made here is overwritten. -->

# Design and UX

## Visual Design Collaboration {#visual-design-collaboration}

**Visual decisions (how the product LOOKS) are collaborative, never unilateral:** (1) surface what is about to be locked; (2) gather 2-3 shipped references that solve it differently; (3) discuss goal and trade-off; (4) the owner locks (spec visual section or ADR); (5) implement. Why: visual identity is differentiation and cannot be assembled from defaults.

- **Wireframe FIRST.** Every undecided visual (layout, component, state set, number or date format) is decided from a rendered wireframe, never prose. Why: text hides what a picture shows.
- **Inside the real screens, with real data:** each option in the real app with the tap-through flow, not floating cards; numbers and dates from the code; real-length text at the narrowest width ("real text is longer" is a measurement owed: right edges, sideways scroll); the shipped component's responsive and format code read first; mockup copy diffed against shipped strings (an unintended change is a decision or a revert); side-note claims measured or cut. Why: placement and overflow show only in context. <!-- PROJECT ADAPTER A21: mockup location, widths, themes. -->
- **Locatable proof or not decided:** a mockup, spec section or explicit lock; otherwise stop, surface, mock. Never mock an already-locked design. Plan placeholders are NOT locked until the owner confirms ("plan defaults are fine" locks them, one Session Log line).
- **Pre-PR visual verification:** confirm it works, then give the owner step-by-step checks (states, every theme, narrow width, click + keyboard) and what changed vs intentionally unchanged. Why: tests prove structure; only a look proves appearance.
- **Show live** in a browser pane on a dev server; an owner on a phone gets PNG shots of the real app (narrow and desktop, light and dark, forced colors when state marks change), anything drawn in marked. <!-- PROJECT ADAPTER A21: how visuals reach the owner when away from the machine. -->
- **Interaction-pattern consistency:** match the app's pattern for the same CLASS of action (inline-expand for in-context tweaks, modal for heavy / destructive / content moments); a new class gets one pattern proposed for app-wide reuse. Why: two feels for one job reads as awkward.
- **Contrast is an a11y primitive,** not a vote: gate the pair the browser renders (text on the composited background at real size), not a token on the bare surface; fix a shared token once. **No repeated boilerplate in user copy** - a sentence already elsewhere dilutes a new one.
- **Visual code takes Path 1** (explicit approval); Path 2 covers tokens, visual-behaviour tests, non-visual config, appearance-preserving refactors.

## Design for Human Error {#design-for-human-error}

- **Exact-entry fields** (passphrase, code, key) let the person SEE what they entered and find the wrong part: name the error's position; offer a reveal, weighed beside the security cost, with leak guards (masked to keyboards and spell check, copy refused, cleared on hide or lock); ruling it out records why and the human-error cost, for the owner. Why: people who fail blind give up and never return.
- **The human factor:** an option list for a hurdle (lock, code, confirm, required step) answers first: (1) what it protects and its value to a stranger, now and with planned features; (2) the realistic threat, not the worst; (3) what a real person can remember and repeat daily; (4) how someone who forgets recovers. Pick the lightest hurdle covering the realistic threat; the copy says what it does not cover. Why: a hurdle people cannot live with is bypassed or abandoned.
