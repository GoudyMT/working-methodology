# Direction and Generated-Look Tells

Load at step 2 when a screen or product needs a visual direction, and at step 5 when reviewing anything built
from a template or by an AI. The refuse list and the surface's job are in rule:craft-floor; how a direction is
locked (references, wireframe first, the owner locks) is rule:visual-design-collaboration. This file adds the
plan that goes into that lock and the tells to strip out.

Why: defaults look the same on every product; a direction drawn from the subject is what makes a screen belong
to it, and an operate screen still earns its look from clarity, not novelty.

## Ground it in the subject

- **Name the subject, the audience and the surface's one job** before any visual idea. If the brief does not
  say, propose them and confirm. The subject's world (its materials, words, documents, habits) is where honest
  visual choices come from.
- **Ambition follows the job** (rule:craft-floor): an operate screen wins on familiar patterns and calm; a
  persuade page may carry one bold idea.
- **Use the real content** from the start; invented filler hides the design's real problems.

## The direction plan (the input to the owner's lock)

1. **Color:** 4-6 named values with hex codes and their roles (canvas, structure, text, accent, status).
2. **Type:** the face or faces and their roles, with the scale ratio ([typography.md](typography.md)).
3. **Layout:** a one-sentence concept per option plus an ASCII wireframe; say the alignment (left, centered).
4. **Principles:** 2-4 lines on what makes this screen this product's and not any product's.

Then **review the plan against the brief:** for each part, ask whether you would have produced it for any
similar brief. If yes, it is a default, not a choice; revise it and say what changed and why. Only then mock it
in the real screens for the owner.

## Restraint

- **Spend boldness in one place.** One memorable element; everything around it quiet.
- **Structure is information.** Borders, numbers, dividers and small labels must encode something. Numbered
  markers (01, 02, 03) only when the content really is a sequence.
- **Before calling it done, remove one thing** that does not serve the job.
- **Decoration goes; structure stays.** Stripping the generated look never removes a table's frame, row
  dividers, search, or a state. An empty-looking list after a cleanup pass is a failure.

## Tells of a generated or template look

The refuse list in rule:craft-floor applies first. These are further defaults that appear whatever the
subject; each is allowed only when the owner's lock asks for it.

| Tell | Plain fix |
|---|---|
| Warm cream canvas, high-contrast serif display, terracotta or clay accent | A palette drawn from the subject |
| Near-black canvas with one acid-green or vermilion accent | Same |
| Broadsheet look: hairline rules, zero radius, dense columns, on a non-editorial product | Same |
| Content chopped into identical rounded cards, one radius everywhere, the same soft grey shadow | Group by meaning; radius by hierarchy ([spacing-and-layout.md](spacing-and-layout.md)) |
| Purple-to-pink or other multi-hue gradient on buttons or backgrounds | Solid accent ([color-and-surfaces.md](color-and-surfaces.md)) |
| Blurred blobs or floating shapes behind content | Remove |
| Neon glow on cards or inputs; hard sticker shadows | 1px border from the surface tokens |
| Pastel pill around static facts (dates, authors, sizes) | Plain secondary text; chips only for filters people toggle |
| Decorative icon in every input | Only search, clear and show-password marks |
| One word in a headline set apart in italic, bold or color | One consistent headline treatment |
| All-caps labels; tracked-out small caps used as decoration | Sentence case labels |
| Facts joined with middle dots; "WORD - fragment" labels | Plain sentences or a small table |
| Tinted near-black (#0B0B0B, #111) standing in for the text color | The text token |
| Monospace for small data labels on a non-technical product | The UI face with tabular figures |
| An arrow appended to every link and button label | The verb alone ([copy-and-labels.md](copy-and-labels.md)) |
| Fade-and-slide-up on every section; hover motion on every card | One motion moment, if any ([motion.md](motion.md)) |
| Illustrated people or mascots in empty states | Text and an action ([states.md](states.md)) |

**Severity** (rule:craft-floor's scale): a tell on a core path is P1, fixed before release; elsewhere P2.

## Search hints for a review

Search changed style files for: `backdrop-filter`, `conic-gradient`, `linear-gradient` with three or more
colors, `border-radius: 999`, `box-shadow` colors with alpha 0.2 or more, `transition: all`, `outline: none`,
`z-index: 9999`. Each hit is a candidate, not a verdict (rule:finding-pipeline).
