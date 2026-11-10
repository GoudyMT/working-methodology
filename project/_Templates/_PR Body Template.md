# PR Body Template

> Two standard PR-description formats. **Pick by stakes** (the SAME split as the Pre-PR Deep Sweep): **Standard** for a feature / sub-project / arc or any PR carrying design decisions or new behaviour; **Lean** for a chore / docs / config / dependency bump / one-line non-behavioural change. When unsure -> Standard. Never inflate a small PR to the large shape.
>
> **Always** (the PR body is outward-facing): ASCII only (`->`, straight quotes, ` - `; no unicode arrows or em dashes); **NO** AI / agent / tool references (describe any review BY DIMENSION, never by mechanism); **NO** links to gitignored vault docs (summarize the review inline; never link sweep reports, specs, ADRs or plans that are not in the public repo); reference only shipped public paths. Title: `type: subject`, at most 72 characters (the squash commit's subject on main); the H1 is `<Area>: <line>` ending in that subject. Show the rendered body + its audit to the owner BEFORE any push or PR command. Full rule: rule:pr-body.
>
> Before drafting, read this template and the two latest merged PR bodies of the same size.

---

## Standard (large: a feature, sub-project or arc)

> **Detailed, not a wall.** For engineers, in plain speak: short active sentences, one idea per bullet. Never cut a detail to make the body shorter; move evidence into a fold (`<details>`). Changes read as a **before / after table**; design decisions and the review result stay **on screen**; the file list and every gate result are left to GitHub's Files and Checks tabs. State the end result, not per-step tallies: keep a number only when it is the result or the reader acts on it (rule:pr-body). Ceilings: <!-- PROJECT ADAPTER A16: e.g. at most 1,550 words in all, 850 on screen, 240 characters per bullet --> `<total>` words, `<on screen>` on screen, `<chars>` per bullet. Audit: `<audit command> <body> "<title>"`.

```md
## <Area>: <one line of what this builds>

<1-2 lines: who gets what. Releases as vX.Y.Z.>

### Summary

| Where | Before | After |
|---|---|---|
| <screen or part> | <what a person met before> | <what they meet now> |

### Design decisions

- **<decision>:** <the why, one or two short sentences>.
- **Size budgets:** <old -> new for each raised limit, and what the raise rests on>.
- **Follow-ups recorded:** <one line>.

### Verification

- <the gate in one line: what ran and that it passed; the Checks tab shows each one>.
- <the production build used and attacked: engines and checks held>.
- <tests failed first; break-check result>.
- <the honest limit, e.g. a device class not verified>.

### Review

<Tier> review of `<commit the sweep covered>`.

| Dimension | Result |
|---|---|
| <each dimension the project lists in .kit/pr-body.json> | <clean, or what was found and how it was handled> |

- **High and critical findings:** <none, or one line each: what, and how it was handled - fixed here or
  accepted by the owner>. An unfixed security finding gets its severity and where it is tracked, never its detail.
- **Deferred:** <none, or each item and where it is tracked: a public issue, or "tracked privately" - never a
  link to a private file>.
- **Accepted risks:** <none, or each risk and why it is accepted>.
- **Secrets:** no secrets or account information in the diff.

Version alignment: YES. <one line>.
```

A row, fold or line that would say "not touched" or "not applicable" is left out: the project lists its review
dimensions in `.kit/pr-body.json` (adapter A16), and GitHub already shows the files and every check.


---

## Lean (chore / docs / small / non-behavioural)

> **A small body for every small PR.** A 1-2 sentence framing, at most 3 changes (what and why, never a file list), 3 gates (the proof; the full local gate as ONE line; the sweep tier (rule:sweep-tiers) with the review dimensions), notes of one sentence or none. Ceilings: <!-- PROJECT ADAPTER A16: e.g. at most 180 words and 18 non-empty lines --> `<words>` words, `<lines>` non-empty lines. A dependency bump names only the figures it can move (audit, budgets) in the gate line. Audit: `<lean audit command> <body> "<title>"`.

```md
## <Area>: <one line of what changed>

<1-2 sentence summary.>

**Changes**
- <change and why>.
- <change and why>.

**Gates**
- [x] <the proof the change is safe: the specific test / acceptance>
- [x] <the full local gate, one line>
- [x] <sweep: light check or exempt, by dimension>

**Notes** - <one-line rationale, or omit.>
```
