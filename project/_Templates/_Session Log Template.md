# Session Log Entry Template

Use this format for every new session entry in [`_Session Log.md`](../_Session Log.md).

**Newest at top.** New entries go directly below the header section, above the most recent prior session. In the SAME edit, move the now-third-newest full entry to the archive and leave its 1-2 line summary (`_Working Standards.md` "Session Log Compression Pattern").

---

```markdown
## Session N - [Short title] (YYYY-MM-DD)

[1-2 sentence summary of what this session accomplished] -> [pointers]

### Completed
- [What was done] - [1-line summary] -> [link to file]
- [What was done] - [1-line summary] -> [link to file]

### Key Decisions (only when non-obvious - explain WHY, not WHAT)
- **The owner:** [decisions the owner locked] -> [link to ADR or design doc]
- **Decided alone (reported):** [decision -> choice -> why]

### Flagged for Next Session
- **Resume Point:** [1 line + link]
- **Read first:** [`_Start Here.md`](../_Start Here.md) -> [`_Working Standards.md`](../_Working Standards.md) -> [`_Loop Learnings.md`](../_Loop Learnings.md) -> [`_Working Memory.md`](../_Working Memory.md) -> [`_Active Plan.md`](../_Active Plan.md) -> [this entry] -> [other files]
- **Open items / blockers:** [if any]
```

---

## Rules

- **Lean format.** Each Completed bullet = "did this + 1-line summary + link to where details live." NO restating, NO audit metadata, NO sub-explanations.
- **Read this template before writing each entry.**
- **Earn the words.** If a citation doesn't change what a future reader does, it's noise.
- **Completed:** 1 line per item; multi-issue topics summarized as one item with a link.
- **Key Decisions:** OPTIONAL. Only non-obvious decisions; explain WHY, not WHAT.
- **Flagged for Next Session:** compact (3-4 lines max).
- **Commit hashes** are recorded here once and nowhere else in the tracking files.

---

## What Doesn't Go Here

- Full design content (design docs / ADRs)
- Research summaries (research artifacts)
- Methodology notes (`_Working Standards.md`)
- Task lists (`_Master Roadmap.md`)
- Bulky narration (link to source-of-truth files instead)
- Process retrospectives (add to `_Working Standards.md` once established as rules)

---

## Anti-Pattern Examples (What Not To Write)

**X Bulky restatement:**
> "Phase 1 (Research): three parallel research agents launched - agent 1 covered the official sources (list of eight names), agent 2 covered the competitors (list of ten names), agent 3 covered user voice..."

**OK Lean:**
> "Landscape research across three streams (official / competitors / user voice) -> [`landscape-research.md`](../_Research/landscape-research.md)"

**X Inline rule explanation:**
> "**Local-first data** - we store all personal information on the device in encrypted storage rather than sending it to a server, achieving privacy through architecture rather than policy..."

**OK Lean:**
> "**Local-first data as architecture, not policy** - the backend cannot see personal data even if compromised -> [ADR-004](../docs/decisions/004-local-first-data.md)"

**X Files Changed audit list:**
> "Files changed this session: `_Working Standards.md` (added 3 rules), `_Master Roadmap.md` (updated status), `_Working Memory.md` (refreshed dashboard)..."

**OK Lean:**
> Link from each Completed bullet to the relevant file; no separate Files Changed section.
