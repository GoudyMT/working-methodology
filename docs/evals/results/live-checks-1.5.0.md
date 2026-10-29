# Live Checks - 1.5.0 (canary hand-back fix, sweep auto-approval)

Run 2026-10-29.

**Why:** in the first long real run (five reviewers in the desktop app) the canary logged every agent "unchecked":
there an agent hands its report back through a tool call, so the stop event carries no text.

| Check | Result |
|---|---|
| The fixed hook on three real desktop-app transcripts, phrase set to their real opening words | PASS: all three logged `hit` |
| The same transcripts, phrase set to words they lack | PASS: all three logged `miss`, the hook blocked (exit 2) |
| The drop-in guide's standalone script on a real transcript | PASS: `hit` |
| What a SubagentStop and a subagent's PreToolUse receive (`claude -p` probe) | `last_assistant_message`, `agent_transcript_path`, `agent_id`, `agent_type` present |

**Not yet proven live:** whether a blocked stop in the desktop app makes an agent close out cleanly after a
hand-back. The first real miss there settles it; until then a miss is still logged and the report treated as void.

The approval script is covered by tests written to fail first (tier rules, clones, caps that only go down, the diff
floor, uncommitted work, owner-only resume, the chained log, outcomes, the 10-sweep trial). Its stated limits:
deliberate evasion (deleting or rewriting the log, a false `--base`, clearing the AI-shell marker, invented outcome
numbers) gets past it.
