# Surfaces and Page Patterns

Load at step 1 (before any markup) to choose where a task lives and, for a page, its pattern. The app's
existing pattern for the same class of action wins (rule:visual-design-collaboration, interaction-pattern
consistency); the defaults below are the proposal for a class the app has not met yet. The surface's job
(operate, read, persuade) is named first per rule:craft-floor.

Why: the wrong surface breaks the person's place in the app; a page with no single job is hard to use and to
keep.

## Where a task lives (default proposal)

| Task | Surface |
|---|---|
| One value (rename, a title, one setting) | Inline edit, in place |
| A short task, 2+ fields, under about 10 s, page stays useful | In-context panel or drawer (or the app's inline-expand) |
| Long, multi-step, or worth a link | Its own page with its own URL |
| Irreversible or heavy | A dialog |

- **Never a dialog on top of a dialog.** Promote the flow to a page, or make it one sequence.
- **Inline edit keeps the box:** display and input share one reserved cell (same width, height, position; a
  one-cell grid with both children stacked). No taller control, no new Save / Cancel row unless the slot
  already exists. Enter saves, Escape cancels. Proof: a neighbour's `getBoundingClientRect()` top and left are
  unchanged after entering edit.
- **Drawers** enter from the trailing edge, 400-480px wide for forms, full height on narrow.
- **Long tasks keep progress in the URL** so refresh, back and share links work.
- **Dismissing without saving loses nothing:** keep a draft ([forms-and-errors.md](forms-and-errors.md)).

## Destructive confirm

- **Every irreversible action** (delete, revoke, reset, disconnect) opens a dialog first. A soft, undoable
  removal may use Undo in a toast instead.
- **Title** names the verb and the exact thing; **body** gives scope and whether it can be undone; **confirm
  button** repeats the verb in the destructive style, and its name says it is destructive (not color alone);
  wording in [copy-and-labels.md](copy-and-labels.md).
- **Cancel has focus on open,** so a stray Enter does nothing harmful. Escape and a scrim click mean Cancel.
- `role="alertdialog"` (or `dialog`) with `aria-labelledby` (title) and `aria-describedby` (body); focus
  handling per [keyboard-and-focus.md](keyboard-and-focus.md).
- **Catastrophic actions** (wipe all data, delete an account) may add typing the exact name to confirm. The
  hurdle is weighed with the human-factor skill (rule:design-for-human-error): the lightest that covers the
  realistic mistake.

## Page patterns

Before writing page markup, state the page's one job and name exactly one pattern. A reviewer should name the
same pattern from the layout alone. Chrome (header, sidebar, menus) and components (charts, dialogs, empty
blocks) live inside a pattern; they are not patterns. List, board and calendar views of the same records are
one page with a view toggle. If nothing fits (a canvas, a node graph, a chat as the whole page), stop and ask.

Every pattern: heading, then a short description (or status and key facts on a detail page), then the body;
page actions sit in the header; empty, loading and error states stay inside the pattern's frame
([states.md](states.md)). Tabs: 1-5 sections take one tab row; 6 or more take a section nav; tab labels never
wrap.

| # | Pattern | One job | Must | Must not | Narrow |
|---|---|---|---|---|---|
| 1 | List | Find and act on many records | Search always present; one Filters control with active filters shown as removable chips and a Clear all; a framed table; a default sort; rows that look clickable at rest | Filter rails, summary tiles above the list, cards as the default index, a filter for a column that is not shown | Toolbar wraps; table scrolls in its region |
| 2 | Detail | Inspect one record | Status and key facts under the title; each tab loads on its own; edits use the surface rules above | One long dump of every field; a card around each section | Facts stack; tabs scroll or become a select |
| 3 | Form | Enter or edit data | A narrow column (about 640px) with labels above fields; wizard steps listed, validated per step; sign-in screens one task each, with a way back | Full-bleed forms; a card per field group; app navigation on sign-in screens | Column full width; Cancel / Save stay reachable |
| 4 | Overview | Glance, then go elsewhere | Read-only; the real items and their state, with links out; at most five summary figures as plain labelled values | Date ranges or drill-down (that is 9); editing here; the hero-number layout and stand-in rings or sparklines (rule:craft-floor) | Stacks to one column |
| 5 | Settings | Change how the product behaves | Section nav; instant toggles save themselves, grouped fields have Save; a separated danger zone last | Tabs as the only category switch; one card per setting; record fields | Section nav becomes a select or a list |
| 6 | Board | Move items through stages | Stages stay visible when filtered; live counts; Add in every column; a keyboard way to change stage | Hiding stages; a board for data with no real stages | Columns snap-scroll; none hidden |
| 7 | Calendar | Work by date | The grid always renders; a Today control; an empty cell creates with its date | A blank page in place of the grid | Grid stays; text stays 12px or more |
| 8 | Split pane | Triage many items fast | A compact list (no table headers) and detail beside it; arrows move the selection | Leaving the page on select; a data table in the list side | List full width; tap opens full detail |
| 9 | Analysis | Change range or filters and read the result | Date range first; one filter change updates every chart; parts load on their own | Using it for a no-filter glance | Filters stack; charts full width |
| 10 | Feed | Work a time-ordered queue or read a history | Unread shown by weight and a mark, not color alone; queues paginate; a history loads more, newest first, in plain words | Table chrome; mixing a queue and a history in one component | Row actions stay visible or in a menu |

**Close calls:** if the main task is the table, it is a List, not an Overview. Split pane only when people flip
between items constantly. Settings configure the product; Detail shows one record.

**Persuade pages** (a public landing or about page) are not patterns: stack sections that tell one story -
promise, proof, offer, objections, the same action again at the end - with no app chrome, and article text in
the capped reading column. Sign-in screens are Form, not marketing.

## Check

- [ ] The task's surface matches the app's existing pattern for its class, or a new one was proposed for reuse.
- [ ] No dialog on a dialog; inline edits move no neighbour.
- [ ] Every irreversible action has the named confirm with Cancel focused.
- [ ] Each new page names one pattern and meets its Must and Narrow cells.
