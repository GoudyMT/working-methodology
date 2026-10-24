---
name: visual-and-ux-design
description: Read before proposing or deciding anything a person sees, or any hurdle (lock, code, confirm) a person must pass.
metadata:
  type: feedback
---

**Wireframe first.** Any undecided visual (layout, component, state set, number or date format) is decided from a rendered wireframe, never prose. Text may frame the problem; the choice waits on the picture. Why: prose invites silent assumptions; "anything visual is confirmed visual".

- **Integrated wireframes**: render each option inside the real app screens (navigation, surrounding content, placement) and show the tap-through flow. Isolated floating option cards are the anti-pattern.
- **No mockup needed when applying an already-locked design**; the lock is the proof.
- **Never treat a visual as decided without locatable proof** (a mockup file, a spec section, an explicit owner lock).
- **Draw real data**: every number and date computed from the code, every text at its real length, at the narrowest supported width beside desktop. Read the shipped component's media queries and format code before drawing it.
- **A "real text is longer" note is a measurement owed.** Measure right edges and sideways scroll at narrow width before the checkpoint.
- **A wireframe that locks copy is diffed against shipped strings**; every unintended change is a decision or a revert. Side-note claims are measured or cut.
- **When the owner reviews from a phone**, show PNG screenshots of the real running app (narrow and desktop, light and dark, forced colors when state marks change). HTML files may not open there. Mark anything drawn in for the photo.
- **Prefer showing live in a browser pane** over writing screenshot files; delete files after they are seen.

**Match the app's existing interaction idiom** for the same class of action: inline-expand for in-context tweaks, a modal for heavy, destructive or content moments. If the action is truly new, propose one pattern for app-wide reuse.

**Contrast is an accessibility primitive**, not a visual vote. Compute the real rendered pair and lock it with a gate; fix the shared token once.

**Design for human error.** For any hurdle: list what it protects and its worth now and later; name the realistic threat, not the worst; ask what a person can remember and repeat daily; pick the lightest hurdle that covers the realistic threat and say plainly what it does not cover; plan recovery for the person who forgets. Exact-entry fields (codes, passphrases, keys) let people see and fix a typo and name the wrong part. Why: a hurdle stronger than its value, or one people cannot remember, gets written down, bypassed or abandoned.

Related: [[goals-and-design-thinking]], [[testing-discipline]].
