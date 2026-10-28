---
name: adr
description: Write an Architecture Decision Record in the MADR format for a structural decision, number it, index it, and link any record it supersedes both ways. Use when a design choice is locked that changes structure, a stack or a data flow, when a spec decision is superseded, or when the owner asks for an ADR or a decision record. Serves rule:sdd-triangle.
---

# ADR

Serves rule:sdd-triangle (a structural change gets an ADR; a superseded decision is marked, never deleted). The
project's `_Templates/_Decision Record Template.md` is the format; the project's decisions folder and index win
over anything here.

## Steps

1. **Check it needs one:** a structural decision, a stack or data-flow choice, or a change to what a locked spec
   or ADR decided (rule:collaborative-design-locks). A small, reversible call goes in the plan instead.
2. **Read the sources:** the template, the decisions index (`000-decisions-index.md`), the two latest ADRs, and
   the examples below.
3. **Number it** with the next free zero-padded number; name it `NNN-short-descriptive-name.md`.
4. **Write it** from the template: the problem, the drivers, at least two real options with pros and cons, the
   chosen option and why, the Dual-Horizon impact (rule:dual-horizon), and the consequences.
5. **Audit:** `node <this skill's folder>/audit.mjs <adr.md>`; fix every fault.
6. **Index it** in `000-decisions-index.md`. If it supersedes a record, set the old one's status to
   `superseded by ADR-NNN` and link both ways; mark every stale location (rule:sdd-triangle, drift markers).
7. **Lock it with the owner** before its status is `accepted` (rule:collaborative-design-locks).

## The audit

`audit.mjs` checks the shape: the `# ADR-NNN: <title>` form, a valid status and a date, the MADR sections, a
named chosen option, a filled-in Dual-Horizon block, and the consequences. It cannot judge whether the case is
sound; the owner's lock does.

## Examples

- [examples/adr-a.md](examples/adr-a.md) and [examples/adr-b.md](examples/adr-b.md) - two accepted ADRs, adapted
  from real ones with the product, names and numbers replaced.
