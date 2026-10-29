# Orchestrator brief - <prong id>: <title>

Read the common brief (`templates/common-brief.md` in the skill) and the project brief first, then the "Rules every brief
carries" block of rule:agent-team-adapter to its last line, with the Read tool (rule:agent-canary). This brief adds only
what is true of this prong.

- **Project brief:** <its absolute path, from the adapter's field 11>
- **Phase:** <plan | build | review> - <where this lead stops; the plan file the last phase handed over>
- **Goal (what the user gets):** <one line, in the user's terms>
- **Scope:** <the roadmap box or the user's request, quoted in full - never paraphrased>
- **Where the items are written down:** <each source, and the part to read; each item is a claim to verify on the
  base>
- **The user's calls to flag:** <privacy, security and legal changes; whether a design needs a red-team before it
  is locked (its Swarm Contract goes in your questions); any stored-format change>
- **Visual items:** <the wireframe rules and the user's lock> | none
- **Size:** <the expected count; propose a split if it is too big for one reviewable pull request; drop nothing
  silently - an item judged not worth doing goes in your questions with the reason>
- **Settled facts and files once contested:** <what the overseer or an earlier prong already settled, with where it
  is written>
- **Which units keep a per-unit checker:** the high-risk rule (`SKILL.md`, "The flow", step 4); name each unit you
  judge small or mechanical enough to go without, and why.
- **Branch, worktree, ports, base:** <branch> | <worktree path> | <port range> | <full base hash, copied from git>
- **Plan file:** <path>
- **Checks to plan:** <the review and its roles; the pre-push test; the pull request body's size>
