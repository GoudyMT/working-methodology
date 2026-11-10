// The call cap (rule:sweep-auto-approval). Spend grows with the square of a reviewer's calls, so a sweep's budget is
// set from a call cap per role. A cap only in the brief is not enough: a probe (2026-11-03) showed the top model
// keeping its own count and the mid model's count running up to 8 behind, on to no report at all. This hook counts
// the real calls and refuses tools near the cap, so the reviewer stops and still hands in its report.
//
// PreToolUse on every tool; only the reviewer type is held to a cap and a ceiling (checkers and builders only to the
// no-waiting rule below). The count is the message ids in the reviewer's own
// transcript, the unit the budget uses; the cap is the "Call cap: N" line of its brief. The hand-back is never held.
// A hook in the agent's own role file did not fire in the probe, so this one sits in the project's settings.
// Anything unexpected lets the call through: the whole-sweep trip stands behind it.
//
// It also holds the two costs the token audit measured (workbench results/token-audit, W5 and W6). A whole file over
// 40 KB is refused: results that size were 57% of reviewer tool bytes, re-read from cache on every later call, so a
// reviewer reads the lines it needs. And nothing that waits past 5 minutes (a background run, a monitor, a longer
// timeout): a reviewer idle that long had its whole cache written again, 50 times, 7% of dollars.
const fs = require('fs');
const path = require('path');

const LARGE_READ = 40 * 1024;
const IDLE_MS = 5 * 60 * 1000;
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// The hook's answer for one tool call: a refusal, or nothing. The dispatcher (guard.cjs) calls this.
function check(input) {
	if (!input.agent_id || input.tool_name === 'SubagentHandback') return;
	const t = input.tool_input || {};
	const type = String(input.agent_type || '');
	const shell = input.tool_name === 'Bash' || input.tool_name === 'PowerShell';
	// E27: the owner's yes and a resume are the owner's alone; an agent the lead started never logs one. Read in the
	// command's own text, a slip net: a spelling built at run time is the limit the guards already name.
	if (shell && /approve\.mjs/i.test(String(t.command || '')) && /--owner-yes|--resume|--owner-setup/i.test(String(t.command || ''))) {
		return deny('The owner\'s yes, a resume and naming the owner are the owner\'s: no agent logs one. Hand the owner\'s words back to the lead in your report.');
	}
	// N1: a checker reads like a reviewer, so it waits on nothing past 5 minutes; a builder's own test run may be long,
	// but a background run or a monitor leaves it idle while its cache expires. Neither has a call cap.
	if (/(^|:)checker$/i.test(type) && (input.tool_name === 'Monitor' || (shell && (t.run_in_background || Number(t.timeout) > IDLE_MS)))) {
		return deny('A checker runs nothing that waits past 5 minutes (a background run, a monitor, a longer timeout): an idle agent has its whole context written to cache again. Run a targeted check instead; CI runs the full suite.');
	}
	if (/(^|:)builder$/i.test(type) && (input.tool_name === 'Monitor' || (shell && t.run_in_background))) {
		return deny('A builder runs its checks in the foreground: a background run or a monitor leaves it idle while its cache expires. Run the targeted tests and wait for them.');
	}
	if (!/(^|:)reviewer$/i.test(type)) return;
	if (input.tool_name === 'Read' && t.offset === undefined && t.limit === undefined) {
		let size = 0;
		try { size = fs.statSync(String(t.file_path)).size; } catch { /* Read reports a missing file itself */ }
		if (size > LARGE_READ) return deny(`${path.basename(String(t.file_path))} is ${Math.round(size / 1024)} KB, over the 40 KB a reviewer reads whole: read the lines you need with offset and limit, or Grep for them first. Your brief's diff names what changed.`);
	}
	if (input.tool_name === 'Monitor' || ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && (t.run_in_background || Number(t.timeout) > IDLE_MS))) {
		return deny('A reviewer runs nothing that waits past 5 minutes (a background run, a monitor, a longer timeout): an idle reviewer has its whole context written to cache again. Run a targeted check instead; CI runs the full suite.');
	}
	const file = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents', `agent-${input.agent_id}.jsonl`);
	// Each message id once, at its last line (streaming writes one line per content block), in the order calls began.
	const calls = new Map();
	let cap = null;
	let ceiling = null;
	// Only the brief, the first user message, sets them: a later one is a tool's answer and may hold any text (F37).
	let brief = true;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		let m;
		try { m = JSON.parse(line).message; } catch { continue; }
		if (!m) continue;
		if (brief && m.role === 'user') {
			brief = false;
			const text = JSON.stringify(m.content);
			const x = text.match(/Call cap: (\d+)/);
			if (x) cap = Number(x[1]);
			const t = text.match(/Token ceiling: (\d+)/);
			if (t) ceiling = Number(t[1]);
		}
		if (m.role === 'assistant' && m.usage && m.id) calls.set(m.id, m.usage);
	}
	if (cap !== null && calls.size >= cap - 1) return deny(`Call cap reached (${calls.size} of ${cap}). Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
	// The token ceiling (M22 C): every call re-reads the context, so the next call costs about what the last one did.
	// The reviewer is stopped while one more call still fits, so its hand-back lands near the ceiling, not past it.
	if (ceiling === null) return;
	const size = (u) => ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'].reduce((t, k) => t + (Number(u[k]) || 0), 0);
	const used = [...calls.values()].reduce((t, u) => t + size(u), 0);
	const last = calls.size ? size([...calls.values()].pop()) : 0;
	const n = (x) => x.toLocaleString('en-US');
	if (used + last >= ceiling) return deny(`Token ceiling reached (${n(used)} of ${n(ceiling)}): one more call would pass it. Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
}

// Anything unexpected lets the call through.
const safeCheck = (input) => { try { return check(input) || null; } catch { return null; } };
if (require.main === module) {
	let out = null;
	try { out = safeCheck(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* lets it through */ }
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check: safeCheck };
