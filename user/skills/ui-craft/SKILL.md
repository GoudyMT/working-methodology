---
name: ui-craft
description: Design, build and check any screen, page, component, form, piece of UI copy or motion so it meets the craft floor - surface choice, type, spacing, color, states, copy, motion and reduced motion, controls, keyboard focus and viewports. Use when building or changing UI, writing button, error or empty-state copy, adding animation, choosing a layout or page pattern, writing a component or handoff spec, or reviewing a UI for polish, accessibility or a generated look. Serves rule:craft-floor.
---

# UI Craft

Serves rule:craft-floor, rule:visual-design-collaboration and rule:design-for-human-error (the project's
design-and-ux rules). Those rules are the floor, the refuse list and the way visual decisions get locked; read
them first. This skill adds the steps and the concrete numbers in `references/`. It never restates the rules.

Why: "looks fine" is not a bar. Concrete numbers and a fixed order of work make a screen's quality checkable.

## When it applies

- Building or changing any screen, page, component, form, overlay or navigation.
- Writing words that appear in the UI: buttons, labels, errors, empty states, confirmations, tooltips.
- Adding or changing motion, hover, press or transition behavior.
- Writing a component spec, a design-system audit or a handoff spec.
- Reviewing a UI for polish, accessibility, a template or generated look, or "it feels off".

A hurdle (lock, code, confirm, required step) also runs the human-factor skill. A diagram or figure follows
rule:diagrams instead.

Why: one entry point for every UI task stops a screen from passing on looks while failing on states or keys.

## Steps

### 1. Name the job and the surface

Name the surface's job (operate, read, persuade) per rule:craft-floor. Match the app's existing pattern for the
same class of action; a new class gets one proposed pattern for app-wide reuse. Choose where the task lives
(inline, panel, page, dialog) and, for a page, name exactly one page pattern.

- Reference: [surfaces-and-pages.md](references/surfaces-and-pages.md).
- **Done when:** the job, the surface and (for a page) the pattern are written in the plan or the chat.

Why: the wrong surface or a page with two jobs cannot be fixed by polish later.

### 2. Set or confirm the direction

If any visual is undecided, write the direction plan, test it against "would I make this for any brief", and
take it to the owner as a wireframe in the real screens (rule:visual-design-collaboration). If the design is
already locked, name the lock and do not mock it again.

- Reference: [direction-and-tells.md](references/direction-and-tells.md); values from
  [typography.md](references/typography.md) and [color-and-surfaces.md](references/color-and-surfaces.md).
- **Done when:** a locatable lock exists (mockup, spec section or the owner's explicit yes) for every visual
  the change touches.

Why: a visual decided in code is drift; a visual locked from prose hides what a picture shows.

### 3. Build it, test first

Write the behaviour tests first (rule:tdd, rule:test-value): each state renders, keys work, validation timing
holds, focus returns. Visual code takes Path 1 (rule:edit-discipline). Build every state, with real-length copy,
using the project's tokens. Load only the references the change touches:

| The change has... | Load |
|---|---|
| Text, headings, numbers | [typography.md](references/typography.md) |
| Gaps, alignment, radius, layering, anything that can shift | [spacing-and-layout.md](references/spacing-and-layout.md) |
| Colors, surfaces, borders, shadows, dark mode | [color-and-surfaces.md](references/color-and-surfaces.md) |
| Inputs, forms, validation, defaults, drafts | [forms-and-errors.md](references/forms-and-errors.md) |
| Fetching, saving, filtering, empty data, failures | [states.md](references/states.md) |
| Any words on screen | [copy-and-labels.md](references/copy-and-labels.md) |
| Animation, transitions, hover or press feedback | [motion.md](references/motion.md) |
| Buttons, icon buttons, tooltips, menus, touch | [icons-and-controls.md](references/icons-and-controls.md) |
| Overlays, composite widgets, shortcuts | [keyboard-and-focus.md](references/keyboard-and-focus.md) |
| Layout across widths, navigation | [viewports.md](references/viewports.md) |
| A shared component, tokens, a handoff | [components-and-handoff.md](references/components-and-handoff.md) |

- **Done when:** the tests went red then green, every state in rule:craft-floor exists in the build, and no
  raw value sits where a token belongs.

Why: states and keys added after the look are the ones that get skipped.

### 4. Check it in a real browser

Run on the dev server, in one batched pass (rule:craft-floor), each check with a recorded result:

1. The floor check on the built screen (rule:craft-floor) and the Check list of each reference you loaded.
2. Widths: the narrowest the project supports and 1280, with `scrollWidth <= clientWidth` measured
   ([viewports.md](references/viewports.md)).
3. Keyboard only, start to finish; focus visible throughout ([keyboard-and-focus.md](references/keyboard-and-focus.md)).
4. Light, dark and forced colors; reduced motion on and off.
5. A throttled network for loading states; a failed request for error states.
6. Then the tools: the contrast gate on rendered pairs and the accessibility scan; merge their hits with your
   own judgment (rule:craft-floor).

- **Done when:** every check above has a result; one that could not run is marked unproven, never passed.

Why: tests prove structure; only a look at the real render proves appearance, and an untried check is not a
pass.

### 5. Review and hand over

For a review, run the ui-review skill (rule:craft-floor's scored review); route each finding through
rule:finding-pipeline (a finding is a claim until reproduced). For a change, give the owner the visual
verification steps from rule:visual-design-collaboration (what changed, what was meant to stay the same, how to
check it). Fix small craft findings in the same change.

- **Done when:** the owner has the steps or the scored review, and every finding is fixed, deferred with a
  place, or accepted with a reason.

Why: a screen is done when someone other than its builder can see that it works.

## Where it comes from

Condensed from 27 third-party skills on visual design, interaction, copy, motion and accessibility, rewritten in
the kit's words. [SOURCES.md](SOURCES.md) lists each source, its license, what was kept and what was dropped,
and how conflicts between sources were settled.
