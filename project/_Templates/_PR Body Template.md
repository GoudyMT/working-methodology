# PR Body Template

> Two standard PR-description formats. **Pick by stakes** (the SAME split as the Pre-PR Deep Sweep): **Standard** for a feature / sub-project / arc or any PR carrying design decisions or new behaviour; **Lean** for a chore / docs / config / dependency bump / one-line non-behavioural change. When unsure -> Standard. Never inflate a small PR to the large shape.
>
> **Always** (the PR body is outward-facing): ASCII only (`->`, straight quotes, ` - `; no unicode arrows or em dashes); **NO** AI / agent / tool references (describe any review BY DIMENSION, never by mechanism); **NO** links to gitignored vault docs (summarize the review inline; never link sweep reports, specs, ADRs or plans that are not in the public repo); reference only shipped public paths. Title: `<Area>: <one line of what this builds>`. Show the rendered body + its audit to the owner BEFORE any push or PR command. Full rule: rule:pr-body.
>
> Before drafting, read this template and the two latest merged PR bodies of the same size.

---

## Standard (large: a feature, sub-project or arc)

> **Detailed, not a wall.** For engineers, in plain speak: short active sentences, one idea per bullet. Never cut a detail to make the body shorter; move evidence into a fold (`<details>`). Changes read as a **before / after table**; design decisions and the review result stay **on screen**; the file list, every gate result and the enumerated clean checks go in **folds**. State the end result, not per-step tallies: keep a number only when it is the result or the reader acts on it (rule:pr-body). Ceilings: <!-- PROJECT ADAPTER A16: e.g. at most 1,550 words in all, 850 on screen, 240 characters per bullet --> `<total>` words, `<on screen>` on screen, `<chars>` per bullet. Audit: `<audit command> <body> "<title>"`.

```md
## <Area>: <one line of what this builds>

<1-2 lines: who gets what. Releases as vX.Y.Z.>

### Summary

| Where | Before | After |
|---|---|---|
| <screen or part> | <what a person met before> | <what they meet now> |

### Included

<details>
<summary>Code, tests and docs</summary>

- <areas and files touched; removals>.

</details>

### Design decisions

- **<decision>:** <the why, one or two short sentences>.
- **Size budgets:** <old -> new for each raised limit, and what the raise rests on>.
- **Follow-ups recorded:** <one line>.

### Verification

- <the gate in one line: what ran and that it passed>.
- <the production build used and attacked: engines and checks held>.
- <tests failed first; break-check result>.
- <the honest limit, e.g. a device class not verified>.

<details>
<summary>Every gate and its result</summary>

| Check | Result |
|---|---|
| Dependency audit | ... |
| Lint; type check | ... |
| Static scan | ... |
| Unit | ... |
| E2E | ... |
| Build; budgets | ... |

</details>

### Review

Reviewed across privacy and the data boundary; supply chain and bundle; legal content and licensing; code
security; <other dimensions>; scaling; and version alignment.

Result: <no critical and no high findings ...>.

| Pass | Found | Fixed here | Recorded as follow-ups |
|---|---|---|---|
| 1, the build | ... | ... | ... |
| 2, the re-check | ... | ... | ... |

<details>
<summary>Verified clean and enumerated rather than asserted</summary>

- <each check; always: no secrets or account information in the diff>.

</details>

Scaling: <operator cost, server change, download size>.

Version alignment: YES. <one line>.
```

GitHub renders markdown inside a fold only after a blank line below `</summary>`.

---

## Lean (chore / docs / small / non-behavioural)

> **A small body for every small PR.** A 1-2 sentence framing, at most 3 changes (what and why, never a file list), 3 gates (the proof; the full local gate as ONE line; the sweep exemption with the review dimensions), notes of one sentence or none. Ceilings: <!-- PROJECT ADAPTER A16: e.g. at most 180 words and 18 non-empty lines --> `<words>` words, `<lines>` non-empty lines. A dependency bump names only the figures it can move (audit, budgets) in the gate line. Audit: `<lean audit command> <body> "<title>"`.

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
