# WCAG 2.2 AA: the checks that matter most

Used in step 5. The standard is WCAG 2.2 (W3C Recommendation, October 2023), level AA. Every accessibility
finding cites its success criterion (SC) number, the measured value and the threshold. The keyboard, screen
reader, zoom and forced-colors PROCESS lives in persona-walks.md; this file holds the criteria and numbers.

## Contrast

| SC | Applies to | Minimum |
|---|---|---|
| 1.4.3 Contrast (Minimum) | body text | 4.5:1 |
| 1.4.3 | large text: 24 px or more, or 18.66 px or more at weight 700+ | 3:1 |
| 1.4.11 Non-text Contrast | control boundaries, focus indicators, icons that carry meaning, chart marks | 3:1 |
| 1.4.1 Use of Color | state or meaning shown by color alone | fail: add text, shape or icon |

- Measure the pair the browser renders: the text color on the composited background at its real size, in every
  theme (rule:craft-floor; rule:visual-design-collaboration "Contrast is an a11y primitive").
- Text over a gradient, image or translucent surface cannot be computed from styles: check the worst spot by eye
  and label the ratio approximate. "Could not compute" is not a pass.
- Exempt: disabled controls, pure decoration, logos.

## Target size

| SC | Minimum | Level |
|---|---|---|
| 2.5.8 Target Size (Minimum) | 24 x 24 CSS px | AA |
| 2.5.5 Target Size (Enhanced) | 44 x 44 CSS px | AAA |

- Report under 24 px as a failure; 24-44 px as a usability note (44 px is the practical touch size).
- 2.5.8 exceptions: inline links inside a sentence; spacing that leaves a 24 px clear circle; a same-function
  target elsewhere that meets the size; a size the browser sets.

## Focus and keyboard

| SC | Requirement | Level |
|---|---|---|
| 2.1.1 Keyboard | every function works from the keyboard | A |
| 2.1.2 No Keyboard Trap | focus can always leave (a modal's own trap is fine if Escape closes it) | A |
| 2.4.3 Focus Order | order follows meaning | A |
| 2.4.7 Focus Visible | a visible indicator exists | AA |
| 2.4.11 Focus Not Obscured (Minimum) | the focused element is not fully hidden by sticky or fixed UI | AA |
| 3.2.1 On Focus | focus alone does not change context | A |

- Check the indicator after a real Tab key press. A focus set by script does not trigger `:focus-visible`, so it
  shows a false "no focus ring".
- The indicator also needs 3:1 against what is next to it (1.4.11). Focus styles are often per component: check
  each control type.
- 2.4.11 is easy to miss: Tab down a long page with a sticky header or bottom bar and watch.

## Names, roles, structure

| SC | Checks | Level |
|---|---|---|
| 4.1.2 Name, Role, Value | every control has a name, the right role, and exposes its state | A |
| 1.3.1 Info and Relationships | headings in order with no skipped level, lists as lists, landmarks, labels tied to fields | A |
| 1.1.1 Non-text Content | meaningful images have a text alternative; decorative ones are hidden | A |
| 2.4.1 Bypass Blocks | a skip link or landmarks | A |
| 2.4.2 Page Titled | a unique, descriptive title per route | A |
| 2.4.4 Link Purpose | the link text (with its context) says where it goes | A |
| 2.4.6 Headings and Labels | headings and labels describe their content | AA |
| 3.1.1 / 3.1.2 Language | `lang` on the page, and on runs in another language | A / AA |

Recurring shapes worth knowing:
- **Polluted name:** a select or group wrapped in a label with no `for` takes every option's text as its name.
- **Toggle buttons that should be a radio group:** one `aria-pressed` button per option gives no group, no
  "1 of 3", no arrow keys. Use a radio group (a fieldset and legend with radios, or the ARIA radiogroup pattern).
- **Clickable div:** no role, no Enter or Space. Use a button.
- **Icon button:** its name says the action ("Close dialog"), not the icon ("X").
- **`tabindex`:** a positive value, or `-1` on a real control, breaks the order.
- **Same title on every route:** fails 2.4.2 and also breaks history, tabs and bookmarks; report it once with
  every consequence.

## Forms, errors and status

| SC | Checks | Level |
|---|---|---|
| 3.3.1 Error Identification | the error is described in text | A |
| 3.3.2 Labels or Instructions | each input has a label | A |
| 3.3.3 Error Suggestion | a fix is offered where one is known | AA |
| 3.3.7 Redundant Entry | data already given in the same process is not asked for again | A |
| 3.3.8 Accessible Authentication (Minimum) | no memory or puzzle test to sign in without an alternative; paste allowed | AA |
| 1.3.5 Identify Input Purpose | `autocomplete` on personal-data fields | AA |
| 4.1.3 Status Messages | async status reaches a screen reader through a live region | AA |
| 3.2.6 Consistent Help | help sits in the same place across pages | A |

Tie each error to its field (`aria-describedby`) so it is read with the field.

## Layout, motion and timing

| SC | Checks | Level |
|---|---|---|
| 1.4.4 Resize Text | text at 200% loses no content or function | AA |
| 1.4.10 Reflow | no two-way scrolling at 320 CSS px wide | AA |
| 1.4.12 Text Spacing | larger line, letter and word spacing breaks nothing | AA |
| 2.5.7 Dragging Movements | every drag has a single-pointer alternative (and a keyboard one, per 2.1.1) | AA |
| 2.2.1 Timing Adjustable | a time limit can be turned off or extended | A |
| 2.2.2 Pause, Stop, Hide | moving or auto-advancing content can be paused | A |
| 2.3.1 Three Flashes | nothing flashes more than 3 times a second | A |
| 2.3.3 Animation from Interactions | honor `prefers-reduced-motion` | AAA (check it anyway) |

An auto-advancing carousel that moves faster than its text can be read fails in practice: compare the interval
to the word count.

## What the review does not prove

Say so in the report's "Unproven" list unless a walk covered it: a full screen-reader pass on each platform the
project supports; Windows High Contrast beyond a forced-colors emulation; 400% zoom; captions and transcripts;
reading level.
