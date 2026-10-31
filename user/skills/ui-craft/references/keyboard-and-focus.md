# Keyboard and Focus

Load at step 3 or 5 for any interactive screen, overlay, composite widget or shortcut. Visible focus is part of
rule:craft-floor's state list; this file says how to build and prove it.

Why: keyboard and screen-reader users, and anyone in a hurry, depend on focus being visible and predictable.

## Reach

- **Every pointer action works by keyboard:** Tab and Shift+Tab to reach, Enter to activate buttons and links,
  Space to activate buttons and toggle checkboxes. Custom widgets get the matching role and key handling.
- **Tab order follows reading order.** DOM order matches layout; positive `tabindex` is never used.
- **Only visible things are tabbable.** Closed panels and off-screen drawers are `inert` or `visibility: hidden`,
  not just moved away.
- **Focus scrolls into view** (`block: 'nearest'`), and is never hidden under a sticky header.
- **A "Skip to main content" link** is the first focusable element on pages with repeated navigation.

## The focus ring

- **Never `outline: none` without a replacement** in the same rule set.
- **Use `:focus-visible`** with one system-wide style: a 2px outline at a 2px offset.
- **The ring contrasts at least 3:1** with the colors next to it, in every theme. Check it on each surface it
  can appear on (rule:visual-design-collaboration: gate the rendered pair). A neutral ring passes more often
  than an accent; either is fine when it passes.
- **Draw it with `outline`, not only `box-shadow`:** forced-colors mode drops shadows, outlines survive. Add a
  shadow halo on top if wanted.
- **No per-component one-off rings.**

## Overlays (dialogs, drawers, menus)

- **On open:** remember the trigger; move focus into the overlay (the first sensible control, or the dialog
  itself; for a destructive confirm, the Cancel button - [surfaces-and-pages.md](surfaces-and-pages.md)).
- **While open:** Tab cycles inside the overlay only; the page behind is `inert` (or `aria-modal="true"` with
  focus contained). Native `<dialog>` with `showModal()` gives most of this.
- **Escape closes** with cancel meaning (ask first only if there is unsaved work). Handle Escape at once, never
  after an exit animation.
- **On close:** focus returns to the trigger; if the trigger is gone, to a sensible spot in the main content.
  Announce a completed action in a polite live region.
- **Non-modal popovers** do not trap focus and do not lock page scroll.

## Standard keys

| Context | Keys |
|---|---|
| Menu button | Enter / Space or ArrowDown opens and focuses the first item; ArrowUp/Down move; Home / End jump; Enter selects; Escape closes and returns to the trigger; typing a letter jumps to a match |
| Tabs | ArrowLeft/Right (or Up/Down if vertical) move; Home / End; selected tab is `tabindex="0"` and `aria-selected="true"` |
| Lists and grids | ArrowUp/Down between rows, Left/Right between cells in editable grids; Enter opens; Space toggles selection; Home / End; Ctrl/Cmd+A selects all when not in a text field |
| Inline edit | Enter commits; Escape cancels and restores the old value; Tab commits and moves on only if documented |
| Text area | Enter is a new line; Ctrl/Cmd+Enter submits |

- **Composite widgets use a roving tabindex:** one item at `tabindex="0"`, the rest `-1`, arrows move it.
  Pick one role family per widget (`menu` + `menuitem`, or `listbox` + `option`) and keep it.
- Drag is never the only way: a board card can be moved with a menu ("Move to...").

## Shortcuts

- **App-wide shortcuts are optional extras,** never the only path. Common ones: `/` focuses search,
  Ctrl/Cmd+K opens a command menu, `?` lists the shortcuts.
- **Single-key shortcuts never fire while typing** in an input, text area or editable region.
- **Never take browser or system keys** (Ctrl/Cmd+W, T, F, L and similar).
- **Show shortcuts platform-aware** (Cmd on Mac, Ctrl elsewhere) in the control's tooltip and on the shortcuts
  list.

## Prove it

- [ ] The whole task is done with the keyboard alone, start to finish.
- [ ] Focus is visible at every step, in light, dark and forced colors.
- [ ] No trap except an open modal; Escape behaves the same on every overlay.
- [ ] Focus returns to the trigger after every overlay closes.
- [ ] Shortcuts do nothing while typing.
- [ ] An automated accessibility scan runs after this manual pass, and both results are merged
      (rule:craft-floor: judgment before the tools).
