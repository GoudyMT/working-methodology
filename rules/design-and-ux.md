---
id: design-and-ux
load: files
paths:
  - "**/*.{svelte,tsx,jsx,vue,css,html}"
when: Before any visual or UX decision, and when a UI file is opened.
tags:
  visual-design-collaboration: visual, layout, wireframe, mockup, screen, color, contrast
  craft-floor: states, empty state, heuristics, design review score, dashboard, board, anti-patterns, slop
  design-for-human-error: mistakes, typo, mistype, forgiving, recover
  diagrams: diagram, figure, architecture picture, flow chart, system map, visual explainer
---

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

## Craft Floor {#craft-floor}

For any screen, page or board, whatever the visual style:

- **Name the surface's job first:** *operate* (an app screen, dashboard, tracking board, settings: wins on clarity, consistency and familiar patterns), *read* (docs, guides, help: wins on structure), *persuade* (a landing page: one bold idea). Ambition follows the job, not the product. Why: a dashboard dressed as a landing page is slower to use.
- **Floor check on the built screen, in one batched pass:** every state exists (hover, disabled, loading, error, empty, real content, visible keyboard focus); body text 65-75 characters wide; more space above a heading than below it; secondary text on a colored surface takes that hue's tint, never gray; icons are drawn icons in one stroke weight, never emoji or Unicode glyphs; numbers that line up use tabular figures.
- **Refuse by default** (the owner's lock can overrule): cards inside cards; the big-number-small-label "hero metric" layout; a small label above every heading; gradient text; decorative blur or glass; a colored stripe thicker than 1px on one side of a card; progress rings, sparklines or blank rounded boxes standing in for real content - a board shows the real items and their evidence; military or other loaded emblems as decoration (seals and insignia are also protected marks).
- **Scored review** for a screen review: Nielsen's 10 heuristics scored 0-4 (n/a where one does not apply); each problem ranked P0 (blocks the task), P1 (fix before release; a user would ask for help), P2 (annoying, has a workaround), P3 (polish); 2-3 people walk it - a first-timer, someone who relies on accessibility, a distracted phone user - each naming the element that failed. Keep the score so the next review shows the trend.
- **Judgment before the tools:** write the design opinion first, then run the automated checks (contrast, the a11y scan), then merge the two; a tool hit the opinion missed is a finding, an opinion the tool contradicts is checked.

Why: "looks fine" is not a bar; a named floor, a refusal list and a scored review make a screen's quality checkable and comparable over time.

## Design for Human Error {#design-for-human-error}

- **Exact-entry fields** (passphrase, code, key) let the person SEE what they entered and find the wrong part: name the error's position; offer a reveal, weighed beside the security cost, with leak guards (masked to keyboards and spell check, copy refused, cleared on hide or lock); ruling it out records why and the human-error cost, for the owner. Why: people who fail blind give up and never return.
- **The human factor:** an option list for a hurdle (lock, code, confirm, required step) answers first: (1) what it protects and its value to a stranger, now and with planned features; (2) the realistic threat, not the worst; (3) what a real person can remember and repeat daily; (4) how someone who forgets recovers. Pick the lightest hurdle covering the realistic threat; the copy says what it does not cover. Why: a hurdle people cannot live with is bypassed or abandoned.

## Diagrams That Explain {#diagrams}

For any diagram or figure that explains a system, a plan or a result:

- **One claim per figure,** stated in its caption as one sentence.
- **Draw the mechanism, not the name:** a request's path through the cache, not a box labelled "cache". **Every arrow gets a verb** ("writes", "polls every 30 s").
- **Never color alone:** a state also shows in shape, position, pattern or a label, so it reads in forced colors and to a color-blind reader.
- **The first screen is the answer:** the main idea as a picture and one sentence; detail follows.
- Every label, arrow and number passes rule:fact-check before the figure is handed over.

Why: a figure that names parts without showing how they connect looks like understanding and explains nothing.
