# Components, Tokens and Handoff

Load at step 3 when building or extending a shared component, at step 5 when auditing a design system, and when
a design must be written down for someone else to build. Code style and surgical changes are rule:code-standards;
the tests a component needs are rule:tdd and rule:test-value.

Why: a component specified once, with every state, is built once; one specified by a screenshot is rebuilt by
guesswork in every place it is used.

## Tokens

- **Every visual value is a named token:** color (brand, semantic, neutral scale), type (sizes, weights, line
  heights), spacing, radius, border width, elevation, motion (durations, curves), z-index.
- **Code uses the token, never the raw value** (`--space-4`, not `16px`). A raw value in a component is a
  finding unless it is a documented optical fix.
- **Themes swap token values;** components never branch on the theme ([color-and-surfaces.md](color-and-surfaces.md)).

## Component API

- **Make a shared component after the third copy,** not the first; until then the pattern is not known.
- **Variants, not boolean soup:** `variant="primary" size="md"`, not `primary large rounded`.
- **Consistent names across components:** `disabled` everywhere (never `isDisabled` on one and `disabled` on
  another); positive booleans (`open`, not `notClosed`); events named `on<Thing>` (`onChange`, `onOpenChange`).
- **Composition over config objects:** children or named slots (header, body, footer) instead of one prop
  holding a nested object. Use shared-state compound parts only when parts really share state; a fixed
  structure with 1-3 props stays simple.
- **One escape hatch** (an extra class) for one-off tweaks, instead of a prop for every style value.
- **Pass through the rest:** unknown attributes (`aria-*`, `data-*`) reach the root element, and a DOM ref is
  available (React: `forwardRef` and spread props; Svelte 5: `...rest` props and `bind:this`).
- **Safe defaults** that cover most uses: `type="button"`, the common size, the neutral variant.
- **Controlled and uncontrolled** both work for stateful inputs when the component is shared widely.
- **A complex component fails alone,** inside its own error boundary or fallback, without blanking the page.
- **Long lists** that render hundreds of rows use a virtual list, so only visible rows are in the page.
- **Watch selector weight:** a type selector and a class selector fighting over the same padding or margin is a
  common cause of spacing that will not change; keep component styles scoped and flat.

## Component spec (write it while building, not after)

1. **Purpose:** what it is and when to use it (and when not).
2. **Variants:** each one and when to use it.
3. **Props:** name, type, default, meaning.
4. **States:** default, hover, focus-visible, active, disabled, loading, error, empty, selected - what each looks
   like and does.
5. **Accessibility:** role, keyboard behavior, what a screen reader announces.
6. **Do and don't:** one or two pairs.
7. **Tokens used.**

Extending the system starts from the problem: which existing components come close and why each is not enough;
then the spec above; then the open questions for the owner.

## Design system audit

| Area | Measure |
|---|---|
| Naming | Inconsistent names for the same idea, with the standard to adopt |
| Token coverage | Count of raw colors, spacing values and font sizes found per category |
| Completeness | Per component: states, variants and docs present (a score out of 10) |

End with the three most valuable fixes, ranked by what a person using the product would notice. Findings run
through rule:finding-pipeline. Document most components partly before documenting a few perfectly.

## Handoff spec (when someone else builds it)

Specify everything a builder would otherwise guess; say why for each judgment call ("collapses on phones
because people hold it one-handed").

- **Overview:** what the screen does and for whom.
- **Layout:** grid, widths, how it changes at each named width ([viewports.md](viewports.md)).
- **Tokens used:** token, value, where.
- **Components:** which one, which variant, which props, anything special.
- **States and interactions:** element x state x behavior, for every state in the list above.
- **Content rules:** character limits, truncation, real-length and translated text.
- **Edge cases:** no data, one item, very many items, very long text, slow network, offline, missing fields.
- **Motion:** element, trigger, what moves, duration, curve, reduced-motion version ([motion.md](motion.md)).
- **Accessibility:** focus order, names and roles, keys, announcements.
