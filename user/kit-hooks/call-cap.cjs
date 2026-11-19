// The call cap (rule:sweep-auto-approval). Spend grows with the square of a reviewer's calls, so a sweep's budget is
// set from a call cap per role. A cap only in the brief is not enough: a probe (2026-11-03) showed the top model
// keeping its own count and the mid model's count running up to 8 behind, on to no report at all. This hook counts
// the real calls and refuses tools near the cap, so the reviewer stops and still hands in its report.
//
// PreToolUse on every tool; only the reviewer type is held to a cap and a ceiling (checkers and builders only to the
// no-waiting rule below). The count is the message ids in the reviewer's own
// transcript, the unit the budget uses; the cap is the "Call cap: N" line of its brief. The hand-back is never held.
// It sits in the project's settings, so it holds every reviewer, whatever its role file carries (role-file hooks
// do fire: the v1.17.0 live run).
// Anything unexpected lets the call through: the whole-sweep trip stands behind it.
//
// It also holds the two costs the token audit measured (workbench results/token-audit, W5 and W6). A whole file over
// 40 KB is refused: results that size were 57% of reviewer tool bytes, re-read from cache on every later call, so a
// reviewer reads the lines it needs. And nothing that waits past 5 minutes (a background run, a monitor, a longer
// timeout): a reviewer idle that long had its whole cache written again, 50 times, 7% of dollars.
const fs = require('fs');
const os = require('os');
const path = require('path');

const LARGE_READ = 40 * 1024;
const IDLE_MS = 5 * 60 * 1000;
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// The hook's answer for one tool call: a refusal, or nothing. The dispatcher (guard.cjs) calls this.
// I10 (build 18): a reviewer is read-only but for its scratch folder (the brief's kit-sweep-<8 hex>/role-<n>), and the
// brief alone never held it: a Bash or PowerShell write outside a sweep scratch folder is refused. A write sign whose
// targets the hook cannot place (no path named, or a path outside scratch) is refused too; a write made by a script
// the reviewer runs (node x.mjs) is past what a command line shows, a limit of this fence. A scratch path is the brief's
// own form, absolute under this machine's temp folder with no `..` step; which role's folder it is goes unchecked, a
// limit too. A line the hook cannot read the way the shell will (a substitution, an eval, an inline interpreter, `>|`)
// is refused whole.
const TMP = os.tmpdir().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const SCRATCH_TAIL = /^\/kit-sweep-[0-9a-f]{8}\/role-\d+(\/|$)/;
const SCRATCH = { test: (w) => {
	const p = String(w).replace(/\\/g, '/');
	if (p.split('/').includes('..')) return false;
	const low = p.toLowerCase();
	return low.startsWith(TMP) && SCRATCH_TAIL.test(low.slice(TMP.length));
} };
const SINK = /^(\/dev\/null|nul|\$null|&\d|&-)$/i;
const UNREADABLE = /\$\(|`|>\||<\(|\beval\b|\b(node|bun|deno|python[\d.]*|py|perl|ruby|php|bash|sh|zsh|dash|pwsh|powershell|cmd)(\.exe)?\b[^;&|\n]*?\s(-e|-c|-p|--eval|--print|-command|-encodedcommand|-ec|\/c)(\s|$)/i;
const WRITERS = /(^|[\s;&|(!{"'])(cp|mv|rm|rmdir|mkdir|touch|tee|dd|install|ln|chmod|chown|truncate|unlink|shred|rsync|out-file|set-content|sc|add-content|ac|new-item|ni|md|remove-item|ri|rd|del|erase|copy-item|cpi|copy|move-item|mi|move|rename-item|rni|ren|mklink|tar|unzip|curl|wget|invoke-webrequest|iwr)(?![\w.-])|\bsed\s+(-\w*i|--in-place)|\bsort\b[^;&|]*\s-o\b|\bgit\s+(-C\s+\S+\s+)?(commit|checkout|reset|restore|stash|clean|switch|merge|rebase|apply|am|add|rm|mv|worktree|branch|tag|push|pull|fetch|config|init|clone|cherry-pick|revert|notes|update-ref|gc|prune)\b/i;
function writesOutsideScratch(command) {
	const c = String(command || '');
	if (UNREADABLE.test(c)) return true;
	for (const m of c.matchAll(/(?:^|[^<>&\d-])(?:\d?>>?|&>>?)\s*("[^"]*"|'[^']*'|[^\s;&|)]+)/g)) {
		const t = m[1].replace(/^['"]|['"]$/g, '');
		if (!SINK.test(t) && !SCRATCH.test(t)) return true;
	}
	// Each command of the line on its own: one that can write may name only scratch paths (its sources too, since a
	// name with no folder is read from the repo), so cp a scratch/b, and a write beside a scratch one, are both held.
	for (const seg of c.split(/;|&&|\|\||\||\n/)) {
		if (!WRITERS.test(seg)) continue;
		const words = seg.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, '')).filter(Boolean);
		const at = words.findIndex((w) => WRITERS.test(` ${w}`));
		const args = words.slice(at + 1).filter((w) => !/^-/.test(w) && !/^\d?[<>]/.test(w));
		if (!args.length || args.some((w) => !SCRATCH.test(w) && !SINK.test(w))) return true;
	}
	return false;
}

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
	if ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && writesOutsideScratch(t.command)) {
		return deny('A reviewer writes only in its scratch folder (the Scratch line of your brief): name that folder in full as the target, or read instead. Nothing in the repository or another role\'s folder is written.');
	}
	const file = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents', `agent-${input.agent_id}.jsonl`);
	// Each message id once, at its last line (streaming writes one line per content block), in the order calls began.
	const calls = new Map();
	let cap = null;
	let ceiling = null;
	// Only the brief, the first user message, sets them: a later one is a tool's answer and may hold any text (F37).
	let brief = true;
	const open = new Map();
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
		if (m.role === 'assistant' && m.usage && m.id) {
			calls.set(m.id, m.usage);
			for (const b of Array.isArray(m.content) ? m.content : []) if (b && b.type === 'tool_use') open.set(b.id, m.id);
		}
		if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) if (b && b.type === 'tool_result') open.delete(b.tool_use_id);
	}
	// The message making this call may be written before the hook runs or after it (the build 11 sweep: a race). A
	// call still waiting on its answer is this one, so it is left out and the count is always the calls before it.
	if (open.has(String(input.tool_use_id || ''))) calls.delete(open.get(String(input.tool_use_id)));
	else if ([...open.values()].includes([...calls.keys()].pop())) calls.delete([...calls.keys()].pop());
	// The transcript holds the calls before this one, and this one is spent already: refused, it still counts, and the
	// report is one call more (build 11: the 1.36.0 and 1.36.1 sweeps each ran a stopped role two calls past its stop).
	// So the cap's last two calls are this refused one and the report.
	if (cap !== null && calls.size >= cap - 2) return deny(`Call cap reached (${calls.size} of ${cap}). Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
	// The token ceiling (M22 C): every call re-reads the context, so the next call costs about what the last one did.
	// Allowed, this call is followed by one more and the report; refused, by the report alone. The reviewer is stopped
	// while all three still fit, so its report lands under the ceiling.
	if (ceiling === null) return;
	const size = (u) => ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'].reduce((t, k) => t + (Number(u[k]) || 0), 0);
	const used = [...calls.values()].reduce((t, u) => t + size(u), 0);
	const sizes = [...calls.values()].map(size);
	const last = sizes.length ? sizes[sizes.length - 1] : 0;
	const prev = sizes.length > 1 ? sizes[sizes.length - 2] : last;
	// The context grows each call, so the next three each cost more than the last did (the build 11 sweep: a role read
	// a large file and passed the ceiling). The reserve adds that growth twice over for each, and room for the report.
	const reserve = 3 * last + 6 * Math.max(0, last - prev) + 5000;
	const n = (x) => x.toLocaleString('en-US');
	if (used + reserve >= ceiling) return deny(`Token ceiling reached (${n(used)} of ${n(ceiling)}): more work would take your report past it. Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
}

// Anything unexpected lets the call through.
const safeCheck = (input) => { try { return check(input) || null; } catch { return null; } };
if (require.main === module) {
	let out = null;
	try { out = safeCheck(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* lets it through */ }
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check: safeCheck };
