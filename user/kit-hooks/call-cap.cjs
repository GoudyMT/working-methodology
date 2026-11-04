// The call cap (rule:sweep-auto-approval). Spend grows with the square of a reviewer's calls, so a sweep's budget is
// set from a call cap per role. A cap only in the brief is not enough: a probe (2026-11-03) showed the top model
// keeping its own count and the mid model's count running up to 8 behind, on to no report at all. This hook counts
// the real calls and refuses tools near the cap, so the reviewer stops and still hands in its report.
//
// PreToolUse on every tool; only the reviewer type is held. The count is the message ids in the reviewer's own
// transcript, the unit the budget uses; the cap is the "Call cap: N" line of its brief. The hand-back is never held.
// A hook in the agent's own role file did not fire in the probe, so this one sits in the project's settings.
// Anything unexpected lets the call through: the whole-sweep trip stands behind it.
const fs = require('fs');
const path = require('path');

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	if (!input.agent_id || !/(^|:)reviewer$/i.test(String(input.agent_type || '')) || input.tool_name === 'SubagentHandback') return;
	const file = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents', `agent-${input.agent_id}.jsonl`);
	const ids = new Set();
	let cap = null;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		let m;
		try { m = JSON.parse(line).message; } catch { continue; }
		if (!m) continue;
		if (cap === null && m.role === 'user') { const x = JSON.stringify(m.content).match(/Call cap: (\d+)/); if (x) cap = Number(x[1]); }
		if (m.role === 'assistant' && m.usage && m.id) ids.add(m.id);
	}
	if (cap === null || ids.size < cap - 1) return;
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Call cap reached (${ids.size} of ${cap}). No more tools: hand in your report now, with what you did not get to as "not checked".` } }));
}

try { main(); } catch { /* anything unexpected lets the call through */ }
