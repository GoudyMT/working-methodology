---
name: agent-teams
description: Read before dispatching builder, checker, scanner or orchestrator agents, or deciding whether to delegate at all.
metadata:
  type: feedback
---

**The build style:** a strong-model lead plans and integrates; mid-tier builders build units test-first in their own worktrees; strong-model checkers verify the high-risk units against the plan, the goals, the rules and the builder's evidence; a cheap scanner gives first passes (counts, collision searches, ASCII scans) that the lead re-runs before trusting. The owner's plan approval starts a batch. Pin exact model versions; a model change is the owner's call.

- **Two modes.** Batch (the lead runs the team) for a handful of units; orchestrated (an orchestrator per phase runs its own team, overseen by the main session) for larger work. The lead does very small work directly.
- **A portable core plus a per-project adapter.** Agents skip project instructions, so the adapter's rules block is pasted verbatim into every brief.
- **Briefs carry a searched collision list and the base commit.** Errors came from briefs built from memory.
- **Give roles tool allow-lists.** Without them agents held outward tools (publish, browser, task spawning) and cost several times more per run.
- **A worktree does not isolate git config or refs; only a clone does.** A probe that writes runs in a scratch clone, with strict shell mode, proving the top-level path before the first write.
- **A resumed agent keeps its old role text**; paste a new rule into the message.
- **Builders committing in parallel need a shared commit lock**: wait, create, commit in the foreground, delete in a finally.
- **Integrate by cherry-pick with a blob check per file.** Remove the agent's worktree and branch as soon as its commits are verified present, and say so.
- **After two FIX rounds the lead finishes the unit.**
- **Sweeps inside a team still reach the owner** through the overseer, each role with a token budget and stop rule.
- **Moving a planning lead's reading to cheap scanners did not pay** (more cost, higher lead peak).
- **Every agent brief forbids remote acts**: commit locally only; no push, PR, merge, remote branch or tag.

**Honest split economics.** Delegation always costs more total compute (spec writing, verification, the agent re-reading context). What it buys is a longer main session, by moving build churn out of the lead's window. Worth it for large mechanical multi-file builds; break-even or worse for small coupled work. A sub-agent's raw token count is not "savings".

**Keep a scoreboard** of runs in the lessons file; review the loosen / tighten rules after a few runs.

Related: [[review-and-sweeps]], [[autonomous-loop-mode]], [[remote-and-outward-actions]].
