# VectorLab UI/UX Skills

Binary, testable skills for AI coding agents. They push low-friction, high-taste interfaces — layout, interaction, microcopy, feedback, and motion — across any frontend stack.

Content is framework-agnostic: CSS primitives, DOM state, and visual geometry — not React-, Vue-, or Svelte-specific APIs.

## Installation (30-second setup)

Pick **one** path. Installing both the Claude Code plugin and skills.sh copies leaves you with every skill twice.

### 1. Get the skills

<details>
<summary><strong>skills.sh (Cursor, Codex, and other agents)</strong></summary>

```bash
npx skills@latest add VectorLabAU/skills
```

Or from a local clone of this folder:

```bash
npx skills@latest add ./path/to/UX-Skills
```

Pick the skills you want, and which coding agents to install them on. **Make sure `setup-ui-ux-skills` and `ux-audit` are among them.**

**Install root:** skills land in a hidden `.skills/` folder unless the project already has `.skills/`, `.agents/skills/`, `.cursor/skills/`, or `.claude/skills/` — reuse that tree. Never install into a top-level `skills/` folder. Do not create a second skill tree next to an existing one.

</details>

<details>
<summary><strong>Claude Code plugin</strong></summary>

**Own marketplace** (available now):

```bash
claude plugin marketplace add VectorLabAU/skills
claude plugin install vectorlab-ux-skills@vectorlab
```

In Claude Code:

```
/plugin marketplace add VectorLabAU/skills
/plugin install vectorlab-ux-skills@vectorlab
```

**Anthropic community marketplace** (after directory approval + nightly sync):

```
/plugin marketplace add anthropics/claude-plugins-community
/plugin install vectorlab-ux-skills@claude-community
```

</details>

### 2. Run `setup-ui-ux-skills`

In your agent, run it once per project. It will:

- Ask for an aesthetic reference (Linear, Stripe, Apple, Raycast, Notion, or Custom)
- Confirm a banned anti-aesthetic list
- Set an accessibility target (WCAG AA or AAA)
- Set brand tone for microcopy
- Detect an existing icon library, or help you pick one (Lucide recommended)

It writes `.ux-profile.md` at the project root and adds a short pointer in `CLAUDE.md` or `AGENTS.md`.

### 3. Build UI

Other skills load when the task fits (page patterns, viewports, forms, surfaces, empty states, loaders, copy, motion). Each one reads `.ux-profile.md` first when that file exists. **Before any new page**, run `page-patterns` and name the pattern. Layouts must pass `viewports` at 375px and 1280px. Before finishing UI, run `ux-audit`.

## Skills

### User-invoked

Reachable only when you ask for them (`disable-model-invocation: true`).

| Skill | Purpose |
| --- | --- |
| [setup-ui-ux-skills](./skills/setup/setup-ui-ux-skills/SKILL.md) | Configure taste, bans, a11y, voice, and icons. Run once per project. |

### User or model invoked

Agents load these before finishing UI, or when you ask by name.

| Skill | Purpose |
| --- | --- |
| [ux-audit](./skills/audit/ux-audit/SKILL.md) | Pre-flight taste audit against every installed domain skill. |

### Model-invoked

Rich descriptions so the agent can reach for them when the task fits.

**Foundations**

- [typography](./skills/visual-taste/typography/SKILL.md) — weights, scale steps, line-height
- [colour-palette](./skills/visual-taste/colour-palette/SKILL.md) — 60-30-10, borders before shadows
- [spacing](./skills/visual-taste/spacing/SKILL.md) — 4/8pt rhythm, optical alignment, line length
- [anti-slop](./skills/visual-taste/anti-slop/SKILL.md) — bans glassmorphism, rainbow CTAs, cartoon empties
- [viewports](./skills/visual-taste/viewports/SKILL.md) — no page overflow at 375/1280, collapsed chrome, profile hit targets, tap-first

**Interaction**

- [page-patterns](./skills/interaction/page-patterns/SKILL.md) — name list / detail / form / dashboard / settings / board / calendar / split pane / analytics / inbox before building a page
- [surfaces](./skills/interaction/surfaces/SKILL.md) — slide-over vs page vs inline; destructive confirm
- [forms](./skills/interaction/forms/SKILL.md) — blur validation, clickable submit
- [keyboard](./skills/interaction/keyboard/SKILL.md) — full keyboard paths, focus rings, traps
- [icon-buttons](./skills/interaction/icon-buttons/SKILL.md) — square icon chrome with required tooltips and shortcut kbd
- [defaults](./skills/interaction/defaults/SKILL.md) — defaults and draft persistence

**Voice**

- [verbs](./skills/voice/verbs/SKILL.md) — imperative CTAs, no OK/Submit
- [errors](./skills/voice/errors/SKILL.md) — errors without blame
- [labels](./skills/voice/labels/SKILL.md) — labels stay; placeholders are format hints

**Feedback**

- [loaders](./skills/feedback/loaders/SKILL.md) — 100ms / 1s thresholds, skeletons
- [empty-states](./skills/feedback/empty-states/SKILL.md) — actionable zero states

**Animation**

- [motion](./skills/animation/motion/SKILL.md) — duration tokens, easing, property whitelist
- [transitions](./skills/animation/transitions/SKILL.md) — enter/exit for overlays and lists
- [reduced-motion](./skills/animation/reduced-motion/SKILL.md) — `prefers-reduced-motion` fallbacks

## Pre-flight taste audit

Before finishing UI work, run [`ux-audit`](./skills/audit/ux-audit/SKILL.md). It scores the working set against the hard gate and every installed domain skill, fixes hard-rule fails, then reports.
