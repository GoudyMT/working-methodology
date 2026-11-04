# Eval key: sheet depth (Part A) and 60-second grounding (Part B, E18)

Written before the build exists. Scored by a separate agent/script. Runner: fresh `claude -p`, tools Read, Grep, Glob, Write, Skill, throwaway project folder, kit installed, no human answers.
Fixtures (runner seeds, identical in every session): Part A prompts 1-2 use project "Larder" (src/recipe_form.html with one button labelled "Submit"; src/recipes.json with 5 sample recipes). Prompt 3 uses an empty folder. Part B uses notes/open-items.md (text below).

## Part A: prompts (3 sessions each, 9 total)

A1 small tweak (verbatim):
"In Larder, the button at the bottom of the recipe form says 'Submit'. Change that label to 'Save recipe'. It is in src/recipe_form.html."

A2 major feature (verbatim):
"Larder keeps my recipes fine, but I want a weekly meal planner. I pick a recipe for each day, and it builds one shopping list for the week, adds up the same ingredient across recipes, and leaves off what is already in my pantry. My partner needs to use it too. I have not thought through much more than that. Let's work out how we build it."

A3 new project (verbatim):
"I run a small bouldering gym and I want to start a new project: something to keep track of our routes. The setters change routes every few weeks and right now it is a mess of whiteboards and a spreadsheet nobody trusts. I do not have a stack in mind. Let's get this project going."

## Part A: counting rules (a script applies these to every file named *.sheet.md that the session wrote anywhere in the project folder; the reply text is not scored)

- Heading: a markdown line starting with 2 to 4 `#` then a space.
- Block: a heading plus all lines until the next heading of the same or higher level (fewer or equal `#`) or end of file.
- Question block: a block whose body has at least one line starting with `Your answer` (case-insensitive, optional leading `**`, `-`, or `>`) OR at least one line matching `^\s*[-*]\s*\[ \]`. The heading text or first body line must contain `?` or the body must carry an options list.
- Not counted: a block whose heading matches /did not ask|anything else|anything i missed|what did i miss/i (the closing catch-all), and the grounding block.
- Session question count = sum of question blocks across all of its sheet files. A session with no sheet file has count 0.
- Grounding: the text between the file title (first `#` line) and the first question block, or the body of a heading containing "grounding" (case-insensitive), whichever exists. It must be at least 30 words and contain no checkbox line. (Script check only; wording quality is not scored in Part A.)
- If the final sheet format differs from this (headings or answer labels changed), the scorer still counts "blocks each holding a question": a block is a heading plus its body, it holds a question if it has an answer slot (a line with "answer" and a colon) or option boxes. The scorer states the adapted rule in its report before scoring and applies it to all 9 sessions alike.

## Part A: bars (all must hold; a bar missed is a regression to diagnose, not a pass)

1. A1: zero sheet files in all 3 sessions. (Chat questions in the reply are not counted. Any sheet file in any A1 session fails the bar.)
2. A2: each of the 3 sessions has exactly 1 sheet file, with at least 3 question blocks, and a grounding (rule above).
3. A3: each of the 3 sessions has 1 to 3 sheet files, at least 3 question blocks in total, and every sheet has a grounding.
4. Medians over 3 sessions: median(A1) < median(A2) < median(A3), strict. (A1 median must be 0.)
5. A3 territory coverage: in every A3 session, the union of its sheets covers all 9 territories below. A territory is covered when at least one counted question block (heading or body, options included) asks the owner about it, per the test shown. Pre-answered statements by the model do not count; the block must ask. Blind scorer marks each territory covered / not covered per session from the blocks only.

Territories (derived from the design: unknowns ledger, pre-mortem, "what did I not ask", cost-with-accuracy, cross-model reach, record reuse, stand-alone sharing; and from the owner's answers on reach, size, cost, write-up, reuse):
 T1 Purpose and who it is for: asks what problem this solves, for whom (setters, climbers, owner, staff), or what triggered it.
 T2 Success and accuracy: asks what "working" means, how the owner would know it works, or what a wrong result would cost him.
 T3 Scope and size: asks what is in the first version, what is out, or how big it should start.
 T4 Cost and constraints: asks about budget, money, time, effort, upkeep, or a tradeoff between cheap and accurate.
 T5 Environment and reach: asks where and on what it runs or is used (devices, on the gym floor, offline, who can open it, which tools or models may read it).
 T6 Data and records: asks what is stored, where it comes from, who may change it, or how it is kept and reused later.
 T7 Options and approach: asks the owner to choose between at least 2 stated approaches (stack, build vs buy, spreadsheet vs app), with options listed.
 T8 Risks and failure: asks what could go wrong, what would make him abandon it, or what failed before (pre-mortem form).
 T9 Unasked: a closing "anything I did not ask?" block exists in the sheet (the excluded catch-all counts here only), or a question explicitly asking what the model missed.

## Part B (E18): prompt, fixture, arms

notes/open-items.md (seeded verbatim):
- N4: search page p95 was 410 ms last week against a 300 ms budget; started after the index change on Oct 21. Could add a cache or revert the index.
- N7: nightly export failed 3 of the last 20 nights, all on nights with more than 5,000 rows. Could chunk the export or raise the timeout.
- N9: login-loop tickets: 14 this week against about 3 normally; cause unknown. Could add logging first or hotfix the cookie domain.

Prompt (verbatim): "There are three open items in notes/open-items.md: N4, N7 and N9. I am away from my desk and will read whatever you write when I am back. Get me to pick which one we do first. Write it up however you think works best."

Arms: 4 sessions on the candidate kit, 4 on the prior kit, same prompt and fixture, same scorer.

## Part B: pass rule per session

Step 1, opening text (script, same for both arms): the owner-facing output is the first `*.sheet.md` written (alphabetical if several) or, if none, the final reply. Drop a leading `#` title line. Take paragraphs from the top until 200 words; cut at word 200 if a paragraph crosses it. 200 words is about 60 seconds of reading (about 200 to 250 words per minute). Lists and tables count as text; the cut applies to them too.

Step 2, fresh reader: a new model sees ONLY that opening text (no project, no notes, no prompt). It answers three questions, each in one sentence, or writes "cannot tell":
 Q-a What is this about / what are we looking at?
 Q-b Why is it in front of the owner now?
 Q-c What was measured or found that brought it into focus?
Step 3, blind judge (sees the reader's answers and the notes fixture, not the arm): passes the session only if
 - Q-a names the actual subject (three open work items about a running service: search speed, nightly export, login problems) not just "three items" or codes;
 - Q-b states a reason tied to the notes (over budget, repeated failures, ticket spike, or that a first-pick decision is needed because of them);
 - Q-c states at least one measurement or finding present in the fixture (410 ms vs 300 ms, 3 of 20 nights, more than 5,000 rows, 14 vs 3 tickets, Oct 21 index change), correctly;
 - none of the three is "cannot tell" or only restates item codes.
Step 4, code order (script, on the same opening text): for each of N4, N7, N9, take its first occurrence. It FAILS if (a) fewer than 2 non-code words precede it on the same line after stripping list markers (`-`, `*`, digits, `|`, `#`, `**`, `>`), or (b) the only text between it and the previous code is punctuation, "and", "or", "vs" (a bare list of codes), or (c) it is the first token of a heading, table cell, or list item. A code never appearing in the opening is fine. The judge also confirms that words preceding the first occurrence actually name that item in plain language (for example "login loops (N9)"); "Option N9" or "Item N9" does not. Session passes Part B only if Step 3 and Step 4 both pass.

Bar: candidate passes at least 3 of 4 AND candidate passes strictly more sessions than the prior kit. Either missed = E18 fails.

## Part C: failures and integrity

- A failed session: nonzero exit, timeout over 10 minutes, no sheet and no reply text, a crash of the harness, or an unreadable fixture. The script reruns it once with the same prompt, same arm, fresh folder. If the rerun also fails, it counts as a fail. If the rerun succeeds, the rerun is scored and the first failure is only logged.
- A failed session counts as a fail for its bar: A1 bar fails if any A1 session ended failed after rerun; A2 and A3 bars fail the same way; question count for medians is 0; Part B counts it as a non-pass for its arm.
- A session that ran fine but broke a bar (e.g. wrote a sheet in A1) is a bar miss, not a failed session; no rerun.
- The report lists rerun counts per arm: Part A (one arm, per prompt), Part B candidate, Part B prior.
- The scorer verifies this file's hash against the committed hash before scoring. Any edit to this file after its commit voids the eval; a void eval is rewritten as a new file and rerun from scratch.
- Scorer is separate from the builder; the builder does not see the reader's answers or the judge notes until scores are filed.
