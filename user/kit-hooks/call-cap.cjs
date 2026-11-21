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
// Anything unexpected lets the call through, with one line in <git common dir>/kit-guard-open.log that the sweep's
// outcome reads (K151): the whole-sweep trip and that line stand behind it.
//
// It also holds the two costs the token audit measured (workbench results/token-audit, W5 and W6). A whole file over
// 40 KB is refused: results that size were 57% of reviewer tool bytes, re-read from cache on every later call, so a
// reviewer reads the lines it needs. And nothing that waits past 5 minutes (a background run, a monitor, a longer
// timeout): a reviewer idle that long had its whole cache written again, 50 times, 7% of dollars.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dollars, reportDollars } = require('./prices.cjs');

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
// Kept short on purpose: a reader with a flag that writes or runs a program (sed's w and e, sort's -o and
// --compress-program, rg's --pre, ForEach-Object's member call) is left off; the Read and Grep tools cover the rest.
const READERS = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'dir', 'grep', 'egrep', 'fgrep', 'find', 'echo', 'printf', 'pwd', 'cd',
	'diff', 'cmp', 'du', 'stat', 'file', 'which', 'type', 'test', 'true', 'false', 'basename', 'dirname', 'realpath', 'readlink',
	'sha256sum', 'md5sum', 'date', 'get-content', 'gc', 'select-string', 'sls', 'get-childitem', 'gci', 'get-item', 'gi', 'test-path',
	'measure-object', 'measure', 'select-object', 'select', 'where-object', 'where', '?', 'sort-object', 'format-table', 'ft',
	'format-list', 'fl', 'out-string', 'write-output', 'write-host', 'get-filehash', 'compare-object', 'resolve-path', 'split-path',
	'join-path', 'get-location', 'set-location', 'sl', 'group-object', 'convertfrom-json', 'convertto-json', 'get-command', 'gcm']);
const GIT_READS = new Set(['log', 'diff', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'cat-file', 'merge-base',
	'rev-list', 'shortlog', 'describe', 'name-rev', 'for-each-ref', 'show-ref', 'diff-tree', 'diff-index', 'whatchanged', 'version']);
// Writes allowed only into scratch: every word after the command is a bare flag or a scratch path.
const SCRATCH_WRITERS = new Set(['cp', 'mv', 'rm', 'mkdir', 'touch', 'tee', 'out-file', 'set-content', 'add-content', 'copy-item', 'remove-item']);
// An interpreter runs a script file it is named, after bare long flags only. A probe script the reviewer wrote in its
// scratch folder is how a sweep proves a finding, so it runs; what that script writes is the limit named above.
const INTERPRETERS = new Set(['node', 'bash', 'sh', 'python', 'python3', 'py']);
const CODE_FLAG = /^--(eval|print|import|require|loader|experimental-loader|input-type)\b/i;
const base = (w) => w.replace(/^['"]|['"]$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

// The reason a reviewer's command is refused, or '' when every command in it is a read or a scratch write.
function fenceFault(command, tool) {
	const c = String(command || '');
	if (UNREADABLE.test(c)) return 'a part the hook cannot read the way the shell will (a substitution, an expansion, an eval, a here-doc)';
	// Bash expands braces inside a word (a{,b}) and groups commands with them; the split below reads neither.
	if (tool === 'Bash' && /[{}]/.test(c)) return 'a brace, which Bash expands or groups past what the hook reads';
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
		// In Bash a backslash is an escape and a quote inside a word joins its parts, so r\m runs rm and --out'put' is
		// --output: no Bash word holds either (the brief's paths use forward slashes).
		if (tool === 'Bash') { const odd = words.find((w) => /[\\'"]/.test(w)); if (odd) return `a word the hook cannot read the way Bash will (${odd})`; }
		if (/^[$&.]$|^[$&]|[('"]/.test(first) || /^\w+=/.test(first)) return `a command word the hook cannot name (${first})`;
		const cmd = base(first);
		const valued = rest.find((w) => /^-[^=:]*[=:]/.test(w) && !/^-\w$/.test(w));
		if (cmd === 'git') {
			// A glob could expand to a file named like an option (--output=x), and a quote or escape joins one: git's
			// words are plain in every shell.
			// A comma makes a PowerShell list and @ splats one, so neither is plain either.
			const unplain = rest.find((w) => /[*?[\]'"\\{}~$`,@()]/.test(w));
			if (unplain) return `a git word the hook cannot read as written (${unplain})`;
			let k = 0;
			while (k < rest.length && /^-/.test(rest[k])) { if (/^-C$/.test(rest[k])) k++; else if (!/^--no-pager$/.test(rest[k])) return `git option ${rest[k]} before the subcommand`; k++; }
			if (!GIT_READS.has(rest[k])) return `git ${rest[k] || ''} is not a read`;
			// git takes any unique start of a long option (--out is --output) and bundles short ones (-po), so both are read.
			const runs = (w) => (/^--./.test(w) && ['output', 'output-directory', 'ext-diff', 'textconv', 'open-files-in-pager'].some((o) => o.startsWith(w.slice(2).split('=')[0].toLowerCase()))) || /^-[^-]*[oO]/.test(w);
			if (rest.slice(k + 1).some(runs)) return 'a git read told to write a file or run a program';
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
	// K151 (build 20): the cap and the ceiling answer before any other hold. Build 19's role 1 ran to 1,072,274 against
	// 749,524: the fence answered six calls first, each a whole context read, and told it to use Read, so it went on. A
	// meter that cannot read its transcript lets the call through and writes why in the git folder's log.
	let held = null;
	try { held = meter(input); } catch (e) { logOpen(input, e); }
	if (held) return held;
	if (input.tool_name === 'Read' && t.offset === undefined && t.limit === undefined) {
		let size = 0;
		try { size = fs.statSync(String(t.file_path)).size; } catch { /* Read reports a missing file itself */ }
		if (size > LARGE_READ) return deny(`${path.basename(String(t.file_path))} is ${Math.round(size / 1024)} KB, over the 40 KB a reviewer reads whole: read the lines you need with offset and limit, or Grep for them first. Your brief's diff names what changed.`);
	}
	if (input.tool_name === 'Monitor' || ((input.tool_name === 'Bash' || input.tool_name === 'PowerShell') && (t.run_in_background || Number(t.timeout) > IDLE_MS))) {
		return deny('A reviewer runs nothing that waits past 5 minutes (a background run, a monitor, a longer timeout): an idle reviewer has its whole context written to cache again. Run a targeted check instead; CI runs the full suite.');
	}
	const fault = (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') ? fenceFault(t.command, input.tool_name) : '';
	if (fault) {
		return deny(`A reviewer's shell runs reads, and writes only in its scratch folder (the Scratch line of your brief); this line has ${fault}. Read with the Read or Grep tool instead, or name your scratch folder in full as the only path.`);
	}
}

// The cap and the ceiling, from the reviewer's own transcript: a refusal, or nothing.
function meter(input) {
	const file = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents', `agent-${input.agent_id}.jsonl`);
	// Each message id once, at its last line (streaming writes one line per content block), in the order calls began.
	const calls = new Map();
	let cap = null;
	let ceiling = null;
	let inDollars = false;
	let twoCeilings = false;
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
			// The brief's own text, with its line breaks: its JSON has none, so a ceiling line could not be told from a
			// ceiling the role's question quotes.
			const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : JSON.stringify(m.content);
			const x = text.match(/Call cap: (\d+)/);
			if (x) cap = Number(x[1]);
			// A ceiling line starts with its label (as the sweep guard reads it); a brief with no line that starts so
			// (one written on a single line) is read wherever the words are.
			const own = /^(?:Token|Dollar) ceiling:/m.test(text);
			const at = (re, flags = '') => text.match(new RegExp(`${own ? '^' : ''}${re}`, own ? `m${flags}` : flags));
			const t = at('Token ceiling: (\\d+)');
			if (t) ceiling = Number(t[1]);
			// K182 (build 22): a brief from approve.mjs 1.48.0 on carries its ceiling in list-price dollars.
			const d = at('Dollar ceiling: \\$(\\d+(?:\\.\\d+)?)');
			if (d) { ceiling = Number(d[1]); inDollars = true; }
			// The commit security review: two ceiling lines could be read either way, so neither is.
			twoCeilings = (at('(Token|Dollar) ceiling:', 'g') || []).length > 1;
		}
		if (m.role === 'assistant' && m.usage && m.id) {
			calls.set(m.id, { ...m.usage, model: m.model });
			for (const b of Array.isArray(m.content) ? m.content : []) if (b && b.type === 'tool_use') open.set(b.id, m.id);
		}
		if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) if (b && b.type === 'tool_result') open.delete(b.tool_use_id);
	}
	// The message making this call may be written before the hook runs or after it (the build 11 sweep: a race). A
	// call still waiting on its answer is this one, so it is left out and the count is always the calls before it.
	// The build 20 sweep: a brief with no cap or no ceiling line is a meter that cannot stop the reviewer, so it is logged
	// as a fail-open and the sweep's outcome names the role.
	if (cap === null || ceiling === null) logOpen(input, `no ${cap === null ? 'Call cap' : 'ceiling (Dollar or Token)'} line in the brief`);
	if (open.has(String(input.tool_use_id || ''))) calls.delete(open.get(String(input.tool_use_id)));
	else if ([...open.values()].includes([...calls.keys()].pop())) calls.delete([...calls.keys()].pop());
	// The transcript holds the calls before this one, and this one is spent already: refused, it still counts, and the
	// report is one call more (build 11: the 1.36.0 and 1.36.1 sweeps each ran a stopped role two calls past its stop).
	// So the cap's last two calls are this refused one and the report.
	if (cap !== null && calls.size >= cap - 2) return deny(`Call cap reached (${calls.size} of ${cap}). Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
	// The token ceiling (M22 C): every call re-reads the context, so the next call costs about what the last one did.
	// Allowed, this call is followed by one more and the report; refused, by the report alone. The reviewer is stopped
	// while all three still fit, so its report lands under the ceiling.
	if (twoCeilings) return deny('Your brief carries more than one ceiling line, so no ceiling can be read from it. Only your hand-back still works: hand in your report now, and tell the lead the brief was not the one approve.mjs wrote.');
	if (ceiling === null) return;
	// K182: in dollars, each call at its own model's list price (an unknown model at the dearest), and the report's room
	// as 5,000 output tokens at the last call's model.
	if (inDollars) {
		const spend = [...calls.values()].map((u) => dollars(u, u.model));
		const used = spend.reduce((t, x) => t + x, 0);
		const last = spend.length ? spend[spend.length - 1] : 0;
		const prev = spend.length > 1 ? spend[spend.length - 2] : last;
		const model = calls.size ? [...calls.values()].pop().model : '';
		const reserve = 3 * last + 6 * Math.max(0, last - prev) + reportDollars(model);
		const usd = (x) => `$${x.toFixed(2)}`;
		if (used + reserve >= ceiling) return deny(`Dollar ceiling reached (${usd(used)} of ${usd(ceiling)}): more work would take your report past it. Only your hand-back still works: hand in your report now, with what you did not get to as "not checked".`);
		return;
	}
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

// One line per fail-open, the cause and never the content, so a gap shows in the sweep's outcome (K151).
function logOpen(input, e) {
	try {
		// git with the repo's fsmonitor off, from Node's own folder, as the other guards run it (the build 20 sweep).
		const r = require('child_process').spawnSync('git', ['-C', String(input.cwd || process.cwd()), '-c', 'core.fsmonitor=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000, cwd: path.dirname(process.execPath) });
		if (r.status === 0) fs.appendFileSync(path.join(r.stdout.trim(), 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'call-cap', agent: String(input.agent_id || ''), cause: String((e && e.code) || (e && e.message) || e).slice(0, 120) })}\n`);
	} catch { /* nothing more to do */ }
}
// Anything unexpected lets the call through.
const safeCheck = (input) => { try { return check(input) || null; } catch (e) { logOpen(input || {}, e); return null; } };
if (require.main === module) {
	let out = null;
	try { out = safeCheck(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* lets it through */ }
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check: safeCheck };
