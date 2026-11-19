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
// I10 (build 18, the owner's pop-up 2026-11-19: "Read-only allowlist"): a reviewer is read-only but for its scratch
// folder (the brief's kit-sweep-<8 hex>/role-<n>). A list of write commands kept leaking new spellings (rm.exe, a path
// to rm, --target-directory=, git -c -c, >&file), so the fence reads the other way: each command of a reviewer's shell
// line must be a known read, or a known write whose every path is in a scratch folder; anything else is refused.
// A scratch path is the brief's own form, absolute under this machine's temp folder, plain characters only (a `$`,
// `~`, brace or glob could expand past what the hook read) and no `..` step. Limits it names: a script the reviewer
// runs (node x.mjs) writes past what a command line shows, and which role's scratch folder it is goes unchecked.
const TMP = os.tmpdir().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const SCRATCH_TAIL = /^\/kit-sweep-[0-9a-f]{8}\/role-\d+(\/|$)/;
const SCRATCH = { test: (w) => {
	const p = String(w).replace(/\\/g, '/');
	if (!/^[\w/.:+@,=-]+$/.test(p) || p.split('/').includes('..')) return false;
	const low = path.posix.normalize(p).toLowerCase();
	return low.startsWith(TMP) && SCRATCH_TAIL.test(low.slice(TMP.length));
} };
const SINK = /^(\/dev\/null|nul|\$null)$/i;
// A line the hook cannot read the way the shell will is refused whole: a substitution, an expansion, an eval, a
// here-doc, a process substitution, a call operator on a built name.
const UNREADABLE = /\$\(|\$\{|`|<<|<\(|>\(|(^|[;|{(\s])[&.]\s*[('"$]|\beval\b|\biex\b|invoke-expression|invoke-command|start-process|\[[\w.]*(io\.)?(file|directory|path)\]::/i;
// Reads: the command word (its folder and .exe dropped) and, for git, the subcommand.
const READERS = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'dir', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'sort', 'uniq', 'cut', 'tr',
	'echo', 'printf', 'pwd', 'cd', 'diff', 'cmp', 'du', 'stat', 'file', 'which', 'type', 'test', 'true', 'false', 'basename',
	'dirname', 'realpath', 'readlink', 'sha256sum', 'md5sum', 'jq', 'column', 'nl', 'od', 'xxd', 'hexdump', 'date', 'sed',
	'get-content', 'gc', 'select-string', 'sls', 'get-childitem', 'gci', 'get-item', 'gi', 'test-path', 'measure-object', 'measure',
	'select-object', 'select', 'where-object', 'where', '?', 'sort-object', 'format-table', 'ft', 'format-list', 'fl', 'out-string',
	'write-output', 'write-host', 'get-filehash', 'compare-object', 'resolve-path', 'split-path', 'join-path', 'get-location',
	'set-location', 'sl', 'foreach-object', '%', 'group-object', 'convertfrom-json', 'convertto-json', 'get-command', 'gcm']);
const GIT_READS = new Set(['log', 'diff', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'cat-file', 'grep', 'merge-base',
	'rev-list', 'shortlog', 'describe', 'name-rev', 'for-each-ref', 'show-ref', 'diff-tree', 'diff-index', 'whatchanged', 'version']);
// Writes allowed only into scratch: every word after the command is a bare flag or a scratch path.
const SCRATCH_WRITERS = new Set(['cp', 'mv', 'rm', 'mkdir', 'touch', 'tee', 'out-file', 'set-content', 'add-content', 'copy-item', 'remove-item']);
// An interpreter runs a script file it is named, after bare long flags only.
const INTERPRETERS = new Set(['node', 'bash', 'sh', 'python', 'python3', 'py']);
const CODE_FLAG = /^--(eval|print|import|require|loader|experimental-loader|input-type)\b/i;
const base = (w) => w.replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

// The reason a reviewer's command is refused, or '' when every command in it is a read or a scratch write.
function fenceFault(command) {
	const c = String(command || '');
	if (UNREADABLE.test(c)) return 'a part the hook cannot read the way the shell will (a substitution, an expansion, an eval, a here-doc)';
	for (const seg of c.split(/;|&&|\|\||\||&(?![>\d-])|\n|\r|\(|\)|\{|\}/)) {
		const raw = seg.trim().split(/\s+/).filter(Boolean);
		if (!raw.length) continue;
		// Redirections: a write goes only to scratch or a sink; 2>&1 and the like are fine; any other shape is refused.
		const words = [];
		for (let i = 0; i < raw.length; i++) {
			const w = raw[i].replace(/^['"]|['"]$/g, '');
			if (/^\d?>&\d$|^>&2$/.test(w)) continue;
			const m = /^(\d?>>?|&>>?)(.*)$/.exec(w);
			if (m) {
				const target = (m[2] || (raw[++i] || '')).replace(/^['"]|['"]$/g, '');
				if (!SCRATCH.test(target) && !SINK.test(target)) return `a write to ${target || 'nowhere named'} outside your scratch folder`;
				continue;
			}
			if (/[<>]/.test(w) && !/^<$/.test(w)) return `a redirection the hook cannot place (${w})`;
			if (w === '<') { i++; continue; }
			words.push(w);
		}
		// A quoted literal alone (PowerShell's 'text' | Out-File ...) runs nothing.
		if (!words.length || (words.length === 1 && /^['"]/.test(raw[0]))) continue;
		const [first, ...rest] = words;
		if (/^[$&.]$|^[$&]|[('"]/.test(first) || /^\w+=/.test(first)) return `a command word the hook cannot name (${first})`;
		const cmd = base(first);
		const valued = rest.find((w) => /^-[^=:]*[=:]/.test(w) && !/^-\w$/.test(w));
		if (cmd === 'git') {
			let k = 0;
			while (k < rest.length && /^-/.test(rest[k])) { if (/^-C$/.test(rest[k])) k++; else if (!/^--no-pager$/.test(rest[k])) return `git option ${rest[k]} before the subcommand`; k++; }
			if (!GIT_READS.has(rest[k])) return `git ${rest[k] || ''} is not a read`;
			if (rest.slice(k + 1).some((w) => /^(--output\b|-o$|--ext-diff$|--textconv$)/.test(w))) return 'a git read told to write a file or run a program';
			continue;
		}
		if (SCRATCH_WRITERS.has(cmd)) {
			if (valued) return `a flag with its value attached (${valued}); name scratch paths as plain words`;
			const paths = rest.filter((w) => !/^-/.test(w));
			if (!paths.length || paths.some((w) => !SCRATCH.test(w))) return `${cmd} names a path outside your scratch folder`;
			continue;
		}
		if (INTERPRETERS.has(cmd)) {
			const file = rest.findIndex((w) => !w.startsWith('-'));
			if (file < 0 || /^data:/i.test(rest[file]) || rest.slice(0, file).some((f) => !/^--[\w-]+$/.test(f) || CODE_FLAG.test(f))) return `${cmd} given code rather than a script file`;
			continue;
		}
		// The project's own test or script run is a script the reviewer runs, the limit named above; nothing else of npm.
		if (cmd === 'npm' && ['test', 't', 'run', 'ls'].includes(rest.find((w) => !w.startsWith('-')))) continue;
		if (!READERS.has(cmd)) return `${cmd} is not on the reviewer's read list`;
		if (cmd === 'find' && rest.some((w) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(w))) return 'find told to write or run';
		if (cmd === 'sort' && rest.some((w) => /^(-o|--output)/.test(w))) return 'sort told to write a file';
		if (cmd === 'uniq' && rest.filter((w) => !/^-/.test(w)).length > 1) return 'uniq told to write a file';
		// sed's own w, W and e commands write or run; read in the segment's text, since a quoted script splits on spaces.
		if (cmd === 'sed' && (rest.some((w) => /^(-\w*i|--in-place)/.test(w)) || /\/[gpI\d]*w\s|(^|[\s;{}'"])[wWe](\s|['";}]|$)/.test(seg.slice(seg.indexOf(first) + first.length)))) return 'sed told to write a file or run one';
	}
	return '';
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
	const fault = (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') ? fenceFault(t.command) : '';
	if (fault) {
		return deny(`A reviewer's shell runs reads, and writes only in its scratch folder (the Scratch line of your brief); this line has ${fault}. Read with the Read or Grep tool instead, or name your scratch folder in full as the only path.`);
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
