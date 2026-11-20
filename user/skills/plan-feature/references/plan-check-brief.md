# Plan gap check: the reviewer's brief

The fixed brief for the plan gap check (Step 5). The lead copies it into one fresh read-only reviewer's prompt,
with FOLDER replaced by a folder that holds the two parts below, and changes nothing else. A fixed brief is what
makes one build's catch comparable with the next one's. It was trialled on three builds of the kit (named a third
or more of each build's highs before any code; about 150,000 tokens and 6 minutes each).

---

You are reviewing a design BEFORE anything is built. This is a plan review, not a code review of the change: the
change does not exist yet.

Folder FOLDER holds:
- design/  everything the builder was handed (the design, its proofs, any carry-overs and the owner's decisions)
- code/    the code the design will change, as it is before the build

Rules: read only inside FOLDER. Do not read any other path on this machine, do not use the web, do not use any
device, project-file or memory tool. Do not write files. Use Read/Grep/Glob/Bash (read-only commands) only.

Task: a pre-mortem. Assume a competent builder builds this design exactly as written, and a hard independent review
afterwards finds high-severity holes in the result. Name those holes now, from the design and the base code. Work
through these lenses, in order:
1. Exemptions and ways out: every exception, escape hatch, "fix" path or allow-list entry the design creates or
   keeps. What else can pass through it?
2. Inputs: every file, setting, environment variable, config value, path and record the new mechanism reads or
   trusts. What happens when each is missing, malformed, oddly encoded, oversized, hostile, or specific to one of
   the platforms the project runs on?
3. Consumers: grep the base code for every existing feature that reads or depends on something the design moves,
   renames or changes. What stops working?
4. Upgrade and hosts: a user on the previous release with files they edited; a host that already has its own setup
   for the thing the design takes over.
5. Failure direction: for each way the new mechanism can fail, does it fail open or closed?
6. The design's own "cannot reach" / limits list: is anything missing from it?
7. Main's checks: CI judges the branch with the base branch's copy of its checks. Does the design add a test or
   helper kind, a large deletion, binaries or a file type those checks read, and can that copy still read it?

Output (your final message, nothing else):
- At most 20 findings, ranked by severity. For each: an id (P1, P2, ...); severity (critical / high / medium / low);
  one or two sentences giving a concrete scenario specific enough to become a test; the design line or base-code
  file:line it rests on; CONFIRMED (you read the code that makes it true) or PLAUSIBLE; and the one line to add to
  the design (an acceptance criterion or a named test).
- Then one line: "Not checked: ..." for anything you did not get to.
- An empty or short list is a valid answer. Do not pad: a finding you would not bet on does not belong in the list.
Keep to about 30 tool-call messages or fewer; batch independent reads.
