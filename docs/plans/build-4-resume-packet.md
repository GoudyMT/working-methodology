# Build 4, stage 3: the resume packet (T3)

Status: design, for the plan check and the owner's lock on rule 11. Nothing here is built.

## 60-second overview

- Today a new or compacted session loads five files by `@import` at start, then rule 11 makes it read the same files again with the Read tool, plus the Session Log entry and the plan. About 42 KB loads twice, and the forced reading is about 40,000 tokens before any work.
- Rule 11 exists for a real drift: sessions said "I just re-read" when they had only seen a summary. The fix keeps that guard and moves it into a script: the proof of a fresh read becomes one tool call whose output the session could not have made up.
- A script writes a resume packet of at most 2,048 bytes at closeout and before a compact. It holds the resume point, the next step, git state, open decisions and a hash of every tracking file it was built from.
- At start the session runs one command. It re-reads every file the packet names from disk, checks each hash, and prints the packet plus any file that changed since. Then the session reads only the plan or spec the resume point names, and whatever file the check flags.
- The four tracking files stop loading by `@import`. AGENTS.md (the rules) keeps loading at start, once.
- Reach: every project at its next install. It changes `project/CLAUDE.md`, rule 11 (`rules/tracking-and-handoff.md`), the closeout skill and the session-start hook.

## Success charter

1. **Expectations.** A session starting from a handoff knows where work stands as well as today, and reads far less to get there. A stale or missing packet is caught, never trusted.
2. **Success criteria** (plan section 6, unchanged):
   - Tokens the rules make a session read before work starts: under 5,000 (bytes / 4), measured in a throwaway install with a filled-in project. Today about 40,200 (estimate).
   - Bytes loaded twice at start: 0 (today 42,291).
   - Recall: median no lower than the released 1.29.0 baseline on the same keys, bar untouched.
   - Use check (T14): the packet is present, wired (closeout and pre-compact write it, the start command reads it) and used (the first tool call of a session is the check).
3. **Options** for the core problem (proving a fresh read without reading everything):
   - A. Packet plus a check command that hashes the files (recommended): one tool call, the drift is caught by the hash, the reading is what changed.
   - B. Packet injected by the session-start hook as context: cheapest, but an injected text is exactly the "reminder" rule 11 says is no read. Rejected.
   - C. Keep rule 11, drop only the `@import`s: removes the double load but not the 40,000-token reading. Fails the first criterion.
4. **Scaling plan.** Thin: the packet is built from the four tracking files and git. Trigger to grow: T4 (state as data) gives the packet a machine-readable source; the packet then reads that instead of parsing markdown.
5. **Ambition tiers.** (a) The criteria above. (b) Stretch, gated: the coordinator of a multi-thread project starts the next thread from the packet alone (E9); not built here.

## What changes

1. **`project/.claude/resume-packet.mjs`** (new), two commands:
   - `write`: builds `.kit/resume-packet.md` from `_Active Plan.md` (its Progress block and Resume Point), `_Working Memory.md` (Last Session, Resume Point), the last `_Session Log.md` entry's heading, `_Loop Learnings.md` (open lesson count), and git (branch, HEAD, clean or not, ahead / behind). Each source file is listed with its sha256. Over 2,048 bytes, it drops the lowest sections first and says what it dropped; it never cuts mid-line. A missing source file is listed as missing, not skipped.
   - `check`: reads the packet, re-hashes each listed file, and prints the packet followed by one line per file: `same`, `CHANGED since the packet` or `missing`. No packet, or a packet older than the last commit that touched a tracking file: it says so and lists the files to read in full (today's Reading Order). Exit 0 always: it reports, it never blocks a session.
2. **Closeout** (skill step 6 and rule:compact-ritual item 5): the handoff's Reading Order becomes "run `node .claude/resume-packet.mjs check`, then the file the Resume Point names". The closeout runs `write` after the session-end batch, so the hashes are of the final files.
3. **Pre-compact hook** (`kit-hook.cjs pre-compact`): also runs `write`, so a compact that was not a closeout still leaves a current packet. A failure is a warning, as every hook failure is.
4. **Rule 11** (`project/CLAUDE.md` hard rule 11, `rule:post-compact-orientation`), proposed words, for the owner's lock:
   > **Post-compact / new session: orientation first.** First action: run `node .claude/resume-packet.mjs check`, then a fresh Read of the file its Resume Point names and of every file it marks CHANGED or missing, before any source-of-truth edit or agent dispatch; no verdict line from the check means the full reading. Visible `[x]` checklist with one line per file the check lists. The packet, system reminders, compaction summaries and memory are not reads. "I just re-read" a file is forbidden unless the Read tool ran on it this session.
5. **`project/CLAUDE.md` Mandatory Reading:** `@AGENTS.md` stays. `@_Start Here.md`, `@_Loop Learnings.md`, `@_Working Memory.md` and `@_Active Plan.md` go; the check covers them.
6. **Recall question 3's key** names today's rule ("fresh reads of every file in the handoff's reading order"). With the new rule that answer is wrong, so key 3 moves with it: a new keys version, the owner's marker. Proposed key: "Run the resume packet check first, then fresh reads of the file its resume point names and of every file it marks changed, with a visible checklist, before any source-of-truth edit or agent dispatch; the summary and reminders are not a re-read".

## What it cannot reach (limits)

- A file changed outside git and outside the packet's list is not seen by the hash. The list is the four tracking files and the plan the Resume Point names.
- A project that never runs a closeout or a compact has no packet: the check falls back to today's full reading.
- The packet is markdown parsed by headings. A project that renamed the headings gets a packet that says which sections it could not find, and the fallback reading.
- Other AI tools read AGENTS.md, not CLAUDE.md, and run no hooks.

## Proof before code

A recall run of the packet against today's reading, in a throwaway install (plan section 7, "first move"): question 3 and the 13 others on the candidate, against the 1.29.0 baseline. $0 cash, subscription use, on the owner's PC.

## Plan check, trial 3 (K20)

One blind pre-mortem reviewer (the brief in the workbench, `results/sweep-vs-planning/probe/brief-premortem.md`) read this design and the released 1.29.0 code before any build: 16 findings (7 high, 7 medium, 2 low), about 143,000 tokens, 23 tool calls. Each is a hypothesis; P2, P3 and P4 were re-checked by reading the files named. All 16 change the design below; none is left for later.

| Id | Sev | The hole | What the design now says |
|---|---|---|---|
| P1 | high | `check` trusted the packet's own file list and text: a hand-edited Resume Point passes with every file "same" | `check` rebuilds the packet from a fixed list (the four tracking files and the plan the Resume Point names) and compares it with the saved one; any difference is CHANGED. Tests: an edited Resume Point, a deleted hash line |
| P2 | high | The sections the parser looked for are not where the templates keep them (`_Working Memory.md` uses bold lines; the Progress block is in the plan) | `write` reads the shapes the shipped templates use; the Progress block comes from the plan file. Tests: the shipped templates and a filled-in fixture give no "not found" line |
| P3 | high | Always-loaded text still orders the old full reading (core.md start line, `_Start Here.md`, `rules/_parts/agents-head.md`, the post-compact line in `scripts/kit.mjs` sessionStartReport, the handoff template, NEW-PROJECT.md) | Every one changes with rule 11. Test: a grep over what the kit ships finds no old Reading Order |
| P4 | high | The orientation steps (sweep check, branch check, caps, mode) live in a module that loads only when a tracking file is opened, which the new flow no longer does | `check` prints the orientation steps after the file list, so they are in context whatever is opened |
| P5 | high | A project with a filled-in CLAUDE.md keeps the old rule 11 and the `@import`s after install | `kit.mjs status` names the leftover `@import` lines and the old rule 11 text to remove. Test: a 1.29 project after install is told which lines |
| P6 | high | Open lessons were reduced to a count | The packet carries each open lesson's title and its never / always line; they are never trimmed |
| P7 | high | Git state could be stale with every file "same" (the tracking files are outside git) | `check` reads branch, HEAD, clean, ahead and behind live and marks a field that differs from the packet CHANGED. Test: a commit after `write` is flagged |
| P8 | medium | "Older than the last commit that touched a tracking file" never fires (the files are untracked) | Removed. Staleness is the hashes plus live git |
| P9 | medium | "or the check ran" let a session claim a re-read it never made | Rule 11: a re-read claim needs a Read call for that file; the check proves only "unchanged since the packet" |
| P10 | medium | A failed or refused check marked nothing CHANGED, so nothing was read (fails open) | `check` ends with one verdict line; rule 11: no verdict line means the full reading. The command is on the project's allow list. Test: a broken packet or a throw still prints the fallback list |
| P11 | medium | The pre-compact write could be skipped by an earlier failure or a missing kit | `write` runs first in the hook, in its own try, before the kit lookup. Tests: kit missing, fold-back throws |
| P12 | medium | The hook's git calls lacked the kit's git safety | `resume-packet.mjs` uses the kit's no-programs settings, a safe working folder and `--no-optional-locks`. Test: a repo whose fsmonitor names a marker script does not run it |
| P13 | medium | Paths with spaces, `%20`, links, `..` or a drive letter were undefined | Packet paths are relative, forward-slash, inside the project root; anything else is refused. Tests for each shape, and a Windows-written packet checks clean under WSL Node |
| P14 | medium | Trimming to 2,048 B could drop a hash line or the Resume Point | Hash lines, the Resume Point and the lessons are never dropped; size is UTF-8 bytes. Test: a 6 KB Progress block |
| P15 | low | Two sessions on one checkout share one packet | The packet records its session and branch, `check` warns on a mismatch; written by temp file and rename |
| P16 | low | A host repo that owns its settings never runs the pre-compact write | The use check (T14) reports the packet as not wired there |

Added to the limits list: git state is checked live but a branch switched by another tool between `write` and `check` is only flagged, not explained; a host repo with its own settings has no packet (the use check says so).

What "tokens read before work starts" counts, to be confirmed with the owner: what the rules make a session read by tool calls before work (the check's output and the plan file). AGENTS.md loads at start by `@import` and is counted in the start load, as today.

## Open for the owner

- Lock rule 11's words (item 4).
- Accept key 3's move (item 6) as a new keys version.
