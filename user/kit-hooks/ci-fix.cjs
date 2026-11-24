'use strict';
// K399 U22 (patch 1.51.4): ci-fix.cjs holds the rules of a red CI run, the shell write forms of them, and the lead's
// after-sweep fence. The state is <git common>/kit-ci-state.json (ci-wait.mjs writes it). Without a settled entry for the pushed head,
// the hook asks gh at most once a minute: gh is the absolute PATH folder's gh (as watch.mjs program() finds it), every
// call names the repo with -R (read from origin with fs), and the whole call has a time budget inside guard.cjs's 4 s.
// gh unreachable reads as CI unknown: the edit goes through with one log row. A red head whose failing items are not
// read yet is written as a provisional red entry first and held until they are. An unreadable state, record or
// diagnosis file throws, and guard.cjs answers with the hook error (tier high in holds.json).
//   (a) while a failing item has no diagnosis, an edit to an existing file is refused (ci-fix.mjs list); once all are
//       diagnosed, only a file a diagnosis names, except the free writes (the changelog and script-made records)
//   (b) with a sweep recorded, an edit adding test( or // planted: is refused unless a ticketed tester (a row of this
//       session with a real ticket, role tester, at or after the sweep); a hand edit to docs/builds/<version>.json is refused
//   (c) a cap raised, a floor lowered, a cap or floor line removed or added in a gate file is held: an Edit or Write gets
//       the "Owner's yes needed" hold (owner-yes.cjs askText), lifted by the owner's accepted pop-up quoting the edit, and closeout
//       then needs the line's gate: owner-yes record (ci-fix.mjs gate-yes); a shell write is held for the owner alone. A Write
//       that creates a gate file is held; an Edit to a gate file whose old text does not match it is held (numbers unchecked)
//   (d) an edit to the files of an item red a second time is refused, with an owner-ask row in the open log; the item
//       leaves (a)'s count
//   docs/builds/*.cifix.jsonl is written only by ci-fix.mjs: refused for every caller, by any tool
//   Shell write forms (Bash, PowerShell, Monitor, the terminal tool) get the same rules, best effort; each target is
//   resolved to an absolute path and judged by its own nearest repo; an unresolvable target is refused only where that
//   repo is red, provisional or has a recorded sweep; a target that names a gate file or the cifix record is held in any state
//   S6: after a recorded sweep the lead's source or test edits need a diagnosis that names the file, whatever the CI state
// The gate words and the per-line compare are read from ci-digest.mjs, the one home closeout.mjs reads too.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OPEN = 'kit-guard-open.log';
const STATE = 'kit-ci-state.json';
const THROTTLE = 'kit-ci-hook.json';
const SWEEP_RECORD = 'kit-sweep-approvals.jsonl';
const AGENT_LOG = 'kit-agent-model.log';
const BUDGET_MS = 3000;
const GH_EVERY_MS = 60 * 1000;
const GH_MAX_MS = 2000;
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'];
const FREE = [/^docs\/changelog\.md$/i, /^docs\/builds\/[^/]+\.next\.jsonl$/i];
const CIFIX_RECORD = /^docs\/builds\/[^/]+\.cifix\.jsonl$/i;
const TEST_FILE = /^tests\/.+\.test\.mjs$/;
const MAY_BE_GATE = /^(\.github\/|scripts\/|tests\/|\.claude\/)|(^|\/)model-floors\.json$/;
const TEST_CALL = /(?<![\w.$])test\s*\(/g;
const PLANTED = /\/\/ planted:/g;
const CLOSEOUT = path.join(__dirname, '..', 'kit-tools', 'closeout.mjs').replace(/\\/g, '/');
const PS_SWITCHES = ['-force', '-recurse', '-nonewline', '-append', '-passthru', '-confirm', '-whatif'];
const PS_FLAG = /-(Path|FilePath|LiteralPath|Destination)(?::|\s+)("[^"]*"|'[^']*'|\S+)/gi;
const CD = /^(?:cd|chdir|pushd|set-location|push-location|sl)(?:\s+|$)(.*)$/i;
const NON_LITERAL = /[$%`(){}*?[\]~]/;

// A call that ran out of its time budget, or a target the hook cannot resolve.
class Deadline extends Error {}
class Unresolved extends Error {}

// The gate words, the per-line compare and the CI digest live once, in ci-digest.mjs (F4), loaded when first needed so an edit
// that no gate rule reads never loads it. A Node that cannot load it throws (ERR_REQUIRE_ESM too): the hook error holds the call.
let DIGEST = null;
const lib = () => DIGEST || (DIGEST = require('../kit-tools/ci-digest.mjs'));
const inGate = (rel) => lib().GATE_FILE.test(rel);

const lf = (s) => String(s ?? '').replace(/\r\n/g, '\n');
const posix = (s) => s.split(path.sep).join('/');
const unquote = (t) => String(t).replace(/^['"]|['"]$/g, '');

function readText(file) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
}

function readJson(file) {
	const text = readText(file);
	if (text === null) return null;
	try { return JSON.parse(text); } catch { return null; }
}

// The repo a folder is in: its root, git dir and common dir. Walks up with fs reads only; null outside a repo.
function repoOf(folder) {
	if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
	let dir = path.resolve(folder);
	for (;;) {
		const dotGit = path.join(dir, '.git');
		let st = null;
		try { st = fs.statSync(dotGit); } catch { /* no .git here */ }
		if (st) {
			let gitdir = dotGit;
			if (st.isFile()) {
				const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) || '');
				if (!m) return null;
				gitdir = path.resolve(dir, m[1].trim());
			}
			const cd = readText(path.join(gitdir, 'commondir'));
			return { root: dir, gitdir, common: cd === null ? gitdir : path.resolve(gitdir, cd.trim()) };
		}
		const up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

// The branch name and the full sha HEAD names, read from the files.
function headOf(repo) {
	const head = (readText(path.join(repo.gitdir, 'HEAD')) || '').trim();
	const m = /^ref:\s*(.+)$/.exec(head);
	if (!m) return { branch: null, sha: /^[0-9a-f]{40}$/i.test(head) ? head : null };
	const ref = m[1].trim();
	const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
	const loose = readText(path.join(repo.common, ref));
	if (loose !== null) return { branch, sha: loose.trim() };
	for (const line of (readText(path.join(repo.common, 'packed-refs')) || '').split('\n')) {
		const p = line.trim().split(' ');
		if (p[1] === ref) return { branch, sha: p[0] };
	}
	return { branch, sha: null };
}

// The sha of the branch's upstream ref (the pushed head), read from the files; null when none is known. The fence keys on it,
// so a local commit on top of the pushed head does not clear the red run.
function pushedOf(repo, branch) {
	if (branch === null) return null;
	const ref = `refs/remotes/origin/${branch}`;
	const loose = readText(path.join(repo.common, ref));
	if (loose !== null) return loose.trim();
	for (const line of (readText(path.join(repo.common, 'packed-refs')) || '').split('\n')) {
		const p = line.trim().split(' ');
		if (p[1] === ref) return p[0];
	}
	return null;
}

// owner/name of the origin remote, read from the repo's config; null when there is none.
function originOf(repo) {
	const cfg = readText(path.join(repo.common, 'config')) || '';
	const m = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(cfg);
	if (!m) return null;
	const r = /[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(m[1]);
	return r ? `${r[1]}/${r[2]}` : null;
}

// gh from the absolute PATH folders, skipping the call's own folder and any relative entry (watch.mjs program() reads so).
function ghPath(cwd) {
	const win = process.platform === 'win32';
	const name = win ? 'gh.exe' : 'gh';
	for (const d of String(process.env.PATH || '').split(win ? ';' : ':')) {
		if (!d || !path.isAbsolute(d) || path.resolve(d).toLowerCase() === path.resolve(cwd).toLowerCase()) continue;
		const p = path.join(d, name);
		try {
			if (fs.statSync(p).isFile()) return p;
		} catch { /* not in this folder */ }
	}
	return null;
}

// One gh call from node's own folder, inside the time left of the call. Null when gh is missing, fails or runs out of time.
function gh(ctx, args) {
	const left = ctx.deadline - Date.now();
	if (left < 50) return null;
	const exe = ghPath(String(ctx.input.cwd || process.cwd()));
	if (exe === null) return null;
	const r = spawnSync(exe, args, { cwd: path.dirname(process.execPath), encoding: 'utf8', timeout: Math.min(GH_MAX_MS, left), windowsHide: true, env: process.env });
	return r.status === 0 ? r.stdout : null;
}

// The CI state file, read whole. Missing is null; unreadable or not a state throws (fail closed).
function readState(common) {
	const text = readText(path.join(common, STATE));
	if (text === null) return null;
	const s = JSON.parse(text);
	if (!s || typeof s !== 'object' || typeof s.sha !== 'string' || !Array.isArray(s.failed)) throw new Error(`${STATE} has no sha and no failed list`);
	return s;
}

function writeState(common, state) {
	try {
		fs.writeFileSync(path.join(common, STATE), `${JSON.stringify(state, null, 2)}\n`);
	} catch { /* the next call reads gh again */ }
}

function logRow(common, cause) {
	fs.appendFileSync(path.join(common, OPEN), `${JSON.stringify({ at: new Date().toISOString(), hook: 'ci-fix', cause })}\n`);
}

// The CI state for HEAD: a settled entry is read as it is; otherwise gh is asked at most once a minute. A provisional
// red entry is held, never read as unknown. Returns the entry for HEAD, or null when none is known.
function ciFor(ctx, repo, head) {
	const state = readState(repo.common);
	const own = state && state.sha === head ? state : null;
	if (own && !own.provisional && own.settled !== false) return own;
	const name = originOf(repo);
	const throttle = readJson(path.join(repo.common, THROTTLE));
	const fresh = !!throttle && throttle.sha === head && Date.now() - throttle.at < GH_EVERY_MS;
	if (name === null || fresh || ctx.deadline - Date.now() < 200) return own;
	const out = gh(ctx, ['run', 'list', '-R', name, '--commit', head, '--json', 'databaseId,name,status,conclusion']);
	fs.writeFileSync(path.join(repo.common, THROTTLE), JSON.stringify({ sha: head, at: Date.now() }));
	let runs = null;
	try { runs = out === null ? null : JSON.parse(out); } catch { runs = null; }
	if (!Array.isArray(runs)) {
		logRow(repo.common, `CI unknown: gh could not read the runs of ${head.slice(0, 12)}; the edit goes through`);
		return own;
	}
	if (runs.length === 0 || runs.some((r) => r.status !== 'completed')) return own;
	const at = new Date().toISOString();
	const red = runs.find((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion));
	if (!red) {
		const green = { sha: head, run: runs[0].databaseId, verdict: 'green', settled: true, failed: [], at };
		writeState(repo.common, green);
		return green;
	}
	return fillRed(ctx, repo, name, head, red.databaseId);
}

// A red head: a provisional entry first, then the failing items from the jobs API and each failed job's log, as long as
// the call's time lasts. Whatever is not read in time stays provisional, which holds edits.
function fillRed(ctx, repo, name, head, runId) {
	const provisional = { sha: head, run: runId, verdict: 'red', settled: false, provisional: true, failed: [], at: new Date().toISOString() };
	writeState(repo.common, provisional);
	const jobsOut = gh(ctx, ['run', 'view', String(runId), '-R', name, '--json', 'jobs']);
	let jobs = null;
	try { jobs = jobsOut === null ? null : JSON.parse(jobsOut); } catch { jobs = null; }
	if (!jobs || !Array.isArray(jobs.jobs)) return provisional;
	try {
		const { digest } = lib();
		const prior = new Set(cifixLines(repo.root).lines.map((l) => l.key));
		const d = digest(jobs, (job) => {
			const text = gh(ctx, ['run', 'view', String(runId), '-R', name, '--log-failed', '--job', String(job.databaseId ?? job.id)]);
			if (text === null) throw new Deadline('a log of the red run was not read in time');
			return text;
		}, prior);
		// A red run whose jobs digest to no items (only a rollup failed) is not read yet: it stays provisional and unsettled.
		if (d.items.length === 0) return provisional;
		const full = { sha: head, run: runId, verdict: 'red', settled: true, failed: d.items, at: new Date().toISOString() };
		writeState(repo.common, full);
		return full;
	} catch (e) {
		// A Node without require(esm) cannot load the digest: the entry stays provisional, which holds edits (F13).
		if (e instanceof Deadline || e.code === 'ERR_REQUIRE_ESM') return provisional;
		throw e;
	}
}

// The cifix record of the build: its version and its lines. Throws on a line that is not an object.
function cifixLines(root) {
	const v = readText(path.join(root, 'VERSION'));
	if (v === null) return { version: null, lines: [] };
	const version = v.trim();
	const text = readText(path.join(root, 'docs', 'builds', `${version}.cifix.jsonl`));
	if (text === null) return { version, lines: [] };
	const lines = text.split('\n').filter((l) => l.trim() !== '').map((l) => {
		const o = JSON.parse(l);
		if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('a cifix line is not an object');
		return o;
	});
	return { version, lines };
}

// The branch's recorded sweep: {since} (the decision's time in ms) for a decision on this branch with an outcome that is
// not noneRan (U20's rule, copied from agent-model.cjs recordedSweep); null when none. Throws on a line that is not a record.
function sweepOf(common, branch) {
	const text = readText(path.join(common, SWEEP_RECORD));
	if (text === null || branch === null) return null;
	const rows = text.split('\n').filter((l) => l.trim() !== '').map((l) => {
		const o = JSON.parse(l);
		if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${SWEEP_RECORD} has a line that is not a record`);
		return o;
	});
	const d = rows.find((x) => x.kind === 'decision' && x.branch === branch && typeof x.contract === 'string'
		&& rows.some((o) => o.kind === 'outcome' && o.contract === x.contract && o.noneRan !== true));
	return d ? { since: Date.parse(String(d.time)) || 0 } : null;
}

// A ticketed tester: a row of this session in kit-agent-model.log with a real ticket, role tester, no reason, at or after the sweep.
function ticketed(common, input, since) {
	if (input.agent_type !== 'tester' || !input.session_id) return false;
	const text = readText(path.join(common, AGENT_LOG));
	if (text === null) return false;
	return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
		.some((r) => r && r.session === input.session_id && typeof r.ticket === 'string' && r.ticket !== '' && r.ticket !== 'none'
			&& r.noTicket !== true && r.role === 'tester' && r.reason === undefined && Date.parse(String(r.at)) >= since);
}

// The repo state of one repo for this call, read once.
function infoOf(ctx, repo) {
	const cached = ctx.infos.get(repo.root);
	if (cached) return cached;
	const head = headOf(repo);
	const ciSha = pushedOf(repo, head.branch) || head.sha;
	const got = ciSha === null ? null : ciFor(ctx, repo, ciSha);
	const cifix = cifixLines(repo.root);
	// A red head, or an entry the hook or ci-wait marked provisional (its items not read yet), holds edits.
	const red = got && (got.verdict === 'red' || got.provisional === true) ? got : null;
	const runNo = red ? red.run : null;
	const items = red ? red.failed.filter((i) => i && typeof i.key === 'string') : [];
	const lines = cifix.lines;
	const diagnosed = (it) => lines.filter((l) => l.key === it.key && l.run === runNo);
	const earlier = (it) => lines.filter((l) => l.key === it.key && l.run !== runNo);
	const info = {
		repo,
		short: head.sha ? head.sha.slice(0, 12) : 'HEAD',
		red,
		provisional: !!(red && red.provisional),
		items,
		open: items.filter((it) => diagnosed(it).length === 0 && earlier(it).length === 0),
		twice: items.filter((it) => diagnosed(it).length === 0 && earlier(it).length > 0),
		earlier,
		named: new Set(lines.filter((l) => l.run === runNo).flatMap((l) => (Array.isArray(l.files) ? l.files : [])).map((f) => String(f).toLowerCase())),
		version: cifix.version,
		sweep: sweepOf(repo.common, head.branch),
	};
	ctx.infos.set(repo.root, info);
	return info;
}

// The absolute path of a target: a relative name against the base folder, which must be absolute. A glob, a variable, an
// expression or a home path is not a literal name: the hook cannot read it, so the call is refused.
function resolveTarget(raw, base) {
	if (typeof raw !== 'string' || raw.trim() === '') throw new Unresolved('the call names no file');
	if (NON_LITERAL.test(raw) || raw.startsWith('~')) throw new Unresolved(`the file ${raw} is named by a variable, glob or expression, which the hook cannot read`);
	if (path.isAbsolute(raw)) return path.resolve(raw);
	if (typeof base !== 'string' || base === '' || !path.isAbsolute(base)) throw new Unresolved(`the file ${raw} is relative to a folder the hook cannot resolve`);
	return path.resolve(base, raw);
}

// The edits of an Edit, Write, MultiEdit or NotebookEdit call: {repo, rel, key, exists, before, after, unmatched}.
function editWrites(ctx, tool, tin) {
	const abs = resolveTarget(tin.file_path ?? tin.notebook_path, String(ctx.input.cwd || ''));
	const repo = repoOf(path.dirname(abs));
	if (repo === null) return [];
	const rel = posix(path.relative(repo.root, abs));
	const now = readText(abs);
	const before = lf(now ?? '');
	let after = before;
	let unmatched = false;
	const apply = (text, oldText, newText, all) => {
		const o = lf(oldText);
		const n = lf(newText);
		if (typeof oldText !== 'string' || o === '' || !text.includes(o)) { unmatched = true; return text; }
		if (all) return text.split(o).join(n);
		const i = text.indexOf(o);
		return text.slice(0, i) + n + text.slice(i + o.length);
	};
	if (tool === 'Write') after = lf(tin.content);
	else if (tool === 'Edit') after = apply(after, tin.old_string, tin.new_string, tin.replace_all === true);
	else if (tool === 'MultiEdit') for (const e of Array.isArray(tin.edits) ? tin.edits : []) after = apply(after, e.old_string, e.new_string, e.replace_all === true);
	return [{ repo, rel, key: rel.toLowerCase(), exists: now !== null, before, after, unmatched, bash: false }];
}

// The names one shell segment writes to: redirects, tee, sed -i, git checkout --, writeFile in node -e, PowerShell's cmdlets
// (every -Path, -FilePath, -LiteralPath and -Destination value, comma lists split; Move-Item's source too) and [IO.File]
// calls (Copy: the destination; Move and Replace: every argument; the rest: the first). Best effort. Names are unresolved.
function shellNames(seg) {
	const names = new Set();
	let unknown = false;
	let unclear = false;
	const add = (t) => { const v = unquote(t); if (v && !/^[-&|;]/.test(v)) names.add(v); };
	// A redirect's target is read; quoted text elsewhere (a commit message, a -> arrow in a string) is not a target.
	for (const m of seg.matchAll(/((?<![-=])>>?\s*)("[^"]*"|'[^']*'|[^\s;&|<>]+)|"[^"]*"|'[^']*'/g)) if (m[2]) add(m[2]);
	// cp, install, ln, rsync (the last name is the target), mv and truncate (every name), at the start of the segment
	const cm = /^(?:\w+=\S*\s+)*(?:(?:sudo|command|exec)\s+)?(cp|mv|install|ln|rsync|truncate)\b(.*)$/i.exec(seg);
	if (cm) {
		const pos = (cm[2].match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) || []).filter((t) => !t.startsWith('-')).map((t) => t.replace(/["']/g, ''));
		const verb = cm[1].toLowerCase();
		const picked = verb === 'mv' || verb === 'truncate' ? pos : pos.length >= 2 ? [pos[pos.length - 1]] : [];
		for (const t of picked) add(t);
	}
	for (const m of seg.matchAll(/\btee\b([^;&|]*)/g)) m[1].trim().split(/\s+/).forEach(add);
	for (const m of seg.matchAll(/\bsed\b([^;&|]*)/g)) if (/(^|\s)(-i|--in-place)/.test(m[1])) m[1].trim().split(/\s+/).forEach(add);
	for (const m of seg.matchAll(/\bgit\s+checkout\b([^;&|]*)/g)) {
		const i = m[1].indexOf(' -- ');
		if (i >= 0) m[1].slice(i + 4).trim().split(/\s+/).forEach(add);
	}
	if (/\bgit\s+apply\b/i.test(seg)) unknown = true;
	// A .NET file call with no closing paren, or a PowerShell list that goes on after a space, is a write the hook cannot read.
	if (/\[(?:System\.)?IO\.File\]::\s*\w+\s*\((?![^)]*\))/i.test(seg)) unclear = true;
	for (const m of seg.matchAll(/\b(?:writeFile|appendFile)(?:Sync)?\s*\(\s*(['"`])([^'"`]+)\1/g)) add(m[2]);
	for (const m of seg.matchAll(/\[(?:System\.)?IO\.File\]::\s*(\w+)\s*\(([^)]*)\)/gi)) {
		const args = m[2].split(',').map((a) => a.trim());
		const method = m[1].toLowerCase();
		const picked = method === 'copy' ? [args[1]] : method === 'move' || method === 'replace' ? args : [args[0]];
		for (const a of picked) if (a !== undefined && a !== '') add(a);
	}
	for (const m of seg.matchAll(/\b(Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Clear-Content|Remove-Item|Rename-Item|New-Item)\b([^;|\r\n]*)/gi)) {
		const cmd = m[1].toLowerCase();
		const args = m[2];
		const flags = [...args.matchAll(PS_FLAG)];
		const rest = args.replace(PS_FLAG, ' ').trim().split(/\s+/).filter(Boolean);
		const pos = [];
		for (let i = 0; i < rest.length; i++) {
			if (rest[i].startsWith('-')) { if (!PS_SWITCHES.includes(rest[i].toLowerCase())) i++; continue; }
			pos.push(rest[i]);
		}
		const values = (keep) => flags.filter((f) => keep(f[1].toLowerCase())).forEach((f) => {
			if (/,$/.test(f[2])) unclear = true;
			unquote(f[2]).split(',').forEach(add);
		});
		if (cmd === 'copy-item') {
			values((flag) => flag === 'destination');
			const hasSource = flags.some((f) => f[1].toLowerCase() !== 'destination');
			if (!flags.some((f) => f[1].toLowerCase() === 'destination') && (pos.length >= 2 || (hasSource && pos.length >= 1))) add(pos[pos.length - 1]);
		} else if (cmd === 'move-item') {
			values(() => true);
			pos.forEach(add);
		} else {
			values(() => true);
			if (flags.length === 0 && pos.length) unquote(pos[0]).split(',').forEach(add);
		}
	}
	// An interpreter call (bash -c, sh -c, pwsh -Command) or a $( ) or backtick substitution whose text carries a write: the
	// write is read, and the call is unclear besides. A heredoc body is text, not a command, so it is not read.
	let interp = false;
	const inners = [];
	const ip = /\b(?:ba|z|da|k)?sh\b[^|;&\n]*?\s-\w*c\s+(.+)$|\b(?:pwsh|powershell)(?:\.exe)?\b[^|;&\n]*?\s-(?:c|command)\s+(.+)$/i.exec(seg);
	if (ip) inners.push(String(ip[1] || ip[2]).trim().replace(/^(["'])([\s\S]*)\1$/, '$2'));
	for (const m of seg.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) inners.push(m[1] || m[2] || '');
	for (const inner of inners) {
		if (inner === '' || /<</.test(inner)) continue;
		const r = shellNames(inner);
		if (r.names.size || r.unknown || r.unclear || r.interp) {
			interp = true;
			r.names.forEach((n) => names.add(n));
			if (r.unknown) unknown = true;
		}
	}
	return { names, unknown, unclear, interp };
}

// A folder change: cd, chdir, pushd, Set-Location, Push-Location or sl to a literal folder moves the base for the segments
// after it; anything else (no argument, a variable, a glob, "-") leaves no base, so a relative target after it is refused.
function moveBase(base, arg, root) {
	const a = unquote(String(arg || '').trim().replace(/^-(?:Path|LiteralPath)(?::|\s+)/i, ''));
	if (base === null || a === '' || a === '-' || NON_LITERAL.test(a)) return null;
	const p = path.resolve(base, a);
	// A folder outside the call's repo, or one that is not there, leaves no base: a relative target after it is unclear.
	if (root !== null && !(p.toLowerCase() === root.toLowerCase() || p.toLowerCase().startsWith(root.toLowerCase() + path.sep))) return null;
	try {
		if (!fs.statSync(p).isDirectory()) return null;
	} catch {
		return null;
	}
	return p;
}

// The writes of a shell call, segment by segment in order (the separators: &&, ||, ;, |, newline). Each named file that
// resolves is a write, judged by its own repo later; one that does not exist is a write with an empty before-text. An
// unresolvable target throws (refused). git apply is a write to the call's own repo.
function shellWrites(ctx, command) {
	const out = [];
	let unknown = false;
	const callRepo = repoOf(String(ctx.input.cwd || ''));
	const callRoot = callRepo === null ? null : callRepo.root;
	let base = String(ctx.input.cwd || '');
	// The separators are &&, ||, ;, |, a newline and a single & (not the & of 2>&1 or &>). After a single & the folder the next
	// segment runs in is not known (the cd before it may have run in the background), so a relative target after it is unclear.
	const pieces = command.split(/(&&|\|\||;|\||(?<![>&|])&(?![&>])|\r?\n)/);
	for (let p = 0; p < pieces.length; p += 2) {
		const seg = pieces[p].trim();
		if (p > 0 && pieces[p - 1] === '&') base = null;
		if (seg === '') continue;
		const cd = CD.exec(seg);
		if (cd) { base = moveBase(base, cd[1], callRoot); continue; }
		const found = shellNames(seg);
		if (found.unknown) unknown = true;
		if (found.unclear) out.push({ unresolved: true, repo: callRepo, rel: seg, key: seg, text: seg, exists: false, before: '', after: null, unmatched: false, bash: true, command, reason: 'a write the hook cannot read' });
		if (found.interp) out.push({ unresolved: true, repo: callRepo, rel: seg, key: seg, text: seg, exists: false, before: '', after: null, unmatched: false, bash: true, command, reason: 'an interpreter call or substitution carries a write' });
		for (const n of found.names) {
			let abs;
			try {
				abs = resolveTarget(n, base === null ? '' : base);
			} catch (e) {
				if (!(e instanceof Unresolved)) throw e;
				out.push({ unresolved: true, repo: callRepo, rel: n, key: n.toLowerCase(), text: seg, exists: false, before: '', after: null, unmatched: false, bash: true, command, reason: e.message });
				continue;
			}
			const repo = repoOf(path.dirname(abs));
			if (repo === null) continue;
			const rel = posix(path.relative(repo.root, abs));
			const now = readText(abs);
			out.push({ repo, rel, key: rel.toLowerCase(), exists: now !== null, before: lf(now ?? ''), after: null, unmatched: false, bash: true, command });
		}
	}
	if (unknown) {
		const repo = repoOf(String(ctx.input.cwd || ''));
		if (repo !== null) out.push({ repo, rel: null, key: null, exists: true, before: '', after: null, unmatched: false, bash: true, unknown: true, command });
	}
	return out;
}

// The gate lines of a file's text (ci-digest.mjs gateLine: the one reader of cap, floor and mixed lines).
function gateEntries(rel, text) {
	const { gateLine } = lib();
	return lf(text).split('\n').map((line) => gateLine(rel, line)).filter(Boolean);
}

// The base and new gate lines paired as multisets, per key (K399 S3F1): the lines of one key are sorted by their numbers and
// paired in order, so a decoy line with the old number cannot take the pairing from a raised one. The base lines left over
// are lost, the new lines left over are added.
function pairGateLines(was, now) {
	const byNums = (a, b) => {
		for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
			const d = (a.nums[i] ?? -1) - (b.nums[i] ?? -1);
			if (d !== 0) return d;
		}
		return 0;
	};
	const pairs = [];
	const lost = [];
	const added = [];
	for (const key of new Set([...was, ...now].map((x) => x.key))) {
		const xs = was.filter((x) => x.key === key).sort(byNums);
		const ys = now.filter((y) => y.key === key).sort(byNums);
		const n = Math.min(xs.length, ys.length);
		for (let i = 0; i < n; i++) pairs.push([xs[i], ys[i]]);
		lost.push(...xs.slice(n));
		added.push(...ys.slice(n));
	}
	return { pairs, lost, added };
}

// The loosening in a gate file against its text before: a cap or floor line removed or added (gate files only), or on a
// matched line any number that a cap raised or a floor lowered (every number on the line counts), or any number of a line that
// holds both kinds. Null when none.
function gateChange(rel, before, after) {
	const { loosened } = lib();
	const strict = inGate(rel);
	const { pairs, lost, added } = pairGateLines(gateEntries(rel, before), gateEntries(rel, after));
	if (strict) {
		if (lost.length) return { text: lost[0].text, kind: lost[0].kind, why: 'removed' };
		if (added.length) return { text: added[0].text, kind: added[0].kind, why: 'added' };
	} else {
		// A test file's timeout: lines (K399 U22, 05:33Z; ruling 3, 06:17Z): more new lines of a key than the base has is a rewrite,
		// held; a lost one is held unless the test it sat in is gone from the new text (ruling 8, 06:52Z). A new line whose key
		// the base lacks is a new test's own line, held only beside a lost line (a rewrite such as 6e4) or when mixed.
		const baseKeys = new Set(pairs.map(([x]) => x.key).concat(lost.map((x) => x.key)));
		const held = added.find((y) => baseKeys.has(y.key) || lost.length > 0 || y.kind === 'mixed');
		if (held) return { text: held.text, kind: held.kind, why: 'added' };
		const gone = lost.filter((x) => TIMEOUT.test(x.text));
		if (gone.length) {
			// Ruling 9: the lost lines are no more than the drop in test starts, and no new name appears (a rename).
			const countOk = gone.length <= startsOf(before).length - startsOf(after).length && !newNamesIn(before, after);
			const kept = gone.find((x) => !(countOk && timeoutLossOk(before, after, x.text)));
			if (kept) return { text: kept.text, kind: kept.kind, why: 'removed' };
		}
	}
	for (const [x, y] of pairs) {
		const i = loosened(x.kind, x.nums, y.nums);
		if (i >= 0) return { text: y.text, kind: y.kind, from: x.nums[i], to: y.nums[i], why: 'changed' };
	}
	return null;
}

const countOf = (re, text) => (text.match(re) || []).length;
const TIMEOUT = /timeout:\s*\d/;

// The test starts of a test file's text: [{ i, name }], from why-rule.cjs testStarts (the file's own parser) plus the test.skip(
// and test.only( forms it does not read, so a skipped test is a kept test (K399 U22, 07:20Z ruling 9).
const SKIP_FORM = /(?<![\w$.])test\.(?:skip|only)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
function startsOf(text) {
	const { testStarts } = require('./why-rule.cjs');
	const lines = lf(text).split('\n');
	const starts = testStarts(lines.join('\n')).map((s) => ({ i: s.i, name: s.name }));
	lines.forEach((l, i) => {
		const m = SKIP_FORM.exec(l);
		if (m) starts.push({ i, name: m[2] });
	});
	return starts.sort((a, b) => a.i - b.i);
}

// Each test's lines: { name, from, to }. A test ends on its own line when its call closes there, else at the first closing
// line at the margin below it (why-rule.cjs tests()), else at the line before the next start.
function spansOf(text) {
	const lines = lf(text).split('\n');
	const starts = startsOf(text);
	return starts.map((s, k) => {
		let to = k + 1 < starts.length ? starts[k + 1].i - 1 : lines.length - 1;
		if (/\}\)\s*;?\s*$/.test(lines[s.i])) to = s.i;
		else {
			const close = lines.findIndex((l, j) => j > s.i && j <= to && /^\}\)/.test(l));
			if (close >= 0) to = close;
		}
		return { name: s.name, from: s.i, to };
	});
}

// The test each timeout: line of a test file's text sits in: { text, name } per line; name is null when the line is outside
// every test's lines.
function timeoutHolders(text) {
	const lines = lf(text).split('\n');
	const spans = spansOf(text);
	const out = [];
	lines.forEach((l, i) => {
		if (!TIMEOUT.test(l)) return;
		const inside = spans.filter((s) => s.from <= i && i <= s.to);
		out.push({ text: l.trim(), name: inside.length ? inside[inside.length - 1].name : null });
	});
	return out;
}

// A test name in the new text that the base text does not have: a rename, or a new test (ruling 9).
function newNamesIn(before, after) {
	const old = new Set(startsOf(before).map((s) => s.name));
	return startsOf(after).some((s) => !old.has(s.name));
}

// The string literals ('x', "x" or `x`) of a text, unescaped, so 'the owner\'s yes' reads as the name it stands for.
function literalsIn(text) {
	const out = new Set();
	for (const l of text.split('\n')) {
		for (const m of l.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g)) out.add((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'));
	}
	return out;
}

// A lost timeout: line (text) is allowed only when every test that held a line of that text is gone from the new text: its
// name is not among the new text's test names and not an unescaped string literal in it (K399 U22, 06:52Z ruling 8; 08:10Z
// ruling 10; security review of 0698f77d). No holder found: held.
function timeoutLossOk(before, after, text) {
	const named = new Set(startsOf(after).map((s) => s.name));
	const literals = literalsIn(after);
	const holders = timeoutHolders(before).filter((h) => h.text === text);
	return holders.length > 0 && holders.every((h) => h.name !== null && !named.has(h.name) && !literals.has(h.name));
}

function aText(info) {
	return `CI is red on ${info.short}: ${info.open.length} failing item(s) have no diagnosis. Run node user/kit-tools/ci-fix.mjs list, then ci-fix.mjs diagnose <n> for each.`;
}

function heldText(info) {
	return `CI is red on ${info.short} and its failing items are not read yet. Wait for the run to settle, then run node user/kit-tools/ci-fix.mjs list.`;
}

// An edit's gate hold asks the owner's yes for that edit's code (guard.cjs lifts it on an accepted pop-up quoting it); a
// shell write has no such code, so its hold is the owner's alone.
// The Edit or Write hold is owner-yes.cjs's askText, as test-scope's hold in guard.cjs is: the quote form for the lead, the
// hand-back note for a subagent.
function gateText(rel, change, input) {
	const what = change.why === 'removed' ? `removes a ${change.kind} line "${change.text}"`
		: change.why === 'added' ? `adds a ${change.kind} line "${change.text}"`
			: `changes a ${change.kind} from ${change.from} to ${change.to}`;
	const { askText } = require('../kit-tools/owner-yes.cjs');
	return askText(`${rel} ${what}; fix the cost at its source first, or put a separate cap to the owner as a choice`, input);
}

// The first reason a write is refused, or null when it goes through. The order: the cifix record, (d), (b), held red, (a),
// (a) named files, S6, and (c) last, so a pop-up yes (which lifts only the "Owner's yes needed" hold of (c)) never hides another rule.
function judge(ctx, w) {
	if (w.unresolved) {
		// An unclear write whose text names a gate file or the cifix record is held in any state, in any folder.
		if (lib().GATE_TEXT.test(String(w.text || w.rel).replace(/\\/g, '/'))) return `Held for the owner: ${w.reason}, and it names a gate file or the cifix record. Fix the cost at its source first, or put a separate cap to the owner as a choice.`;
		// Any other unclear target is a write to the call's repo: refused only where that repo is red, provisional or swept.
		if (w.repo === null) return null;
		const info = infoOf(ctx, w.repo);
		if (info.red || info.provisional || info.sweep) return `Held: ${w.reason}; an unclear write target is refused in a red, provisional or swept repo`;
		return null;
	}
	if (w.unknown) {
		const info = infoOf(ctx, w.repo);
		if (info.provisional) return heldText(info);
		if (info.red && info.open.length) return aText(info);
		return info.red ? 'git apply names files the hook cannot read while CI is red: diagnose each item and edit by hand' : null;
	}
	const info = infoOf(ctx, w.repo);
	const k = w.key;
	if (CIFIX_RECORD.test(k)) return `docs/builds/${path.basename(k)} is written only by ci-fix.mjs (diagnose or fix), for every caller`;
	// (d)
	const held = info.red && info.twice.find((it) => k === String(it.file || '').toLowerCase()
		|| info.earlier(it).some((l) => (Array.isArray(l.files) ? l.files : []).some((f) => String(f).toLowerCase() === k)));
	if (held) {
		logRow(info.repo.common, `owner-ask: ${held.name} is red a second time (${held.key}); its files are held until the owner says yes`);
		return `Held for the owner: ${held.name} is red a second time (${held.key}). Stop and ask the owner: a grant id (ci-fix.mjs diagnose <n> --grant <id>) allows attempt 2.`;
	}
	// (b)
	if (info.sweep) {
		if (info.version !== null && k === `docs/builds/${info.version}.json`.toLowerCase()) {
			return `the build record docs/builds/${info.version}.json is written by build-record.mjs after the sweep, so a hand edit is refused`;
		}
		const addsTest = w.bash
			? (TEST_FILE.test(k) && countOf(TEST_CALL, w.command) > 0) || countOf(PLANTED, w.command) > 0
			: countOf(TEST_CALL, w.after) > countOf(TEST_CALL, w.before) || countOf(PLANTED, w.after) > countOf(PLANTED, w.before);
		if (addsTest && !ticketed(info.repo.common, ctx.input, info.sweep.since)) {
			return `a test( or // planted: tag is added after the sweep, and only a ticketed tester writes one; record the deferral with node ${CLOSEOUT} defer "<text>"`;
		}
	}
	if (info.provisional) return heldText(info);
	// (a) and its named-file rule: a new file is not in the red run's files, so it is not held here
	if (info.red && info.open.length && w.exists) return aText(info);
	const free = FREE.some((re) => re.test(k));
	if (info.red && info.items.length && w.exists && !free && !info.named.has(k)) {
		return `CI is red on ${info.short}: ${w.rel} is named by no diagnosis. Edit only the files of ci-fix.mjs diagnose lines.`;
	}
	// S6
	if (info.sweep && ctx.lead && !free && !info.named.has(k)) {
		return `after the sweep the lead's source or test edits need a diagnosis that names the file: ${w.rel} is named by none. Diagnose the red run with ci-fix.mjs, or hand a ticketed finding to a tester.`;
	}
	// (c)
	// Only a path under a folder a gate file lives in, or a timeout: in a test file, loads the shared gate reader: a Node that
	// cannot require an ES module (before 22.12) then holds only those writes with the hook error, not every edit.
	const gate = MAY_BE_GATE.test(k) && inGate(k);
	const timeoutEdit = TEST_FILE.test(k) && /timeout:\s*\d/.test(`${w.before}\n${w.after}`);
	if (w.bash && gate) return `Held for the owner: a shell write to the gate file ${w.rel} cannot be read here. Fix the cost at its source first, or put a separate cap to the owner as a choice.`;
	if (!w.bash && gate && !w.exists) return `Held for the owner: ${w.rel} is a new gate file. Fix the cost at its source first, or put a separate cap to the owner as a choice.`;
	if (!w.bash && gate && w.unmatched) return `Held for the owner: the edit to ${w.rel} does not match its text, so its numbers cannot be checked. Fix the cost at its source first, or put a separate cap to the owner as a choice.`;
	if (!w.bash && (gate || timeoutEdit)) {
		const change = gateChange(k, w.before, w.after);
		if (change) return gateText(w.rel, change, ctx.input);
	}
	return null;
}

function check(input) {
	if (!input || typeof input !== 'object') return null;
	const tool = String(input.tool_name || '');
	const edit = EDIT_TOOLS.includes(tool);
	if (!edit && !SHELL_TOOLS.includes(tool)) return null;
	const ctx = { input, lead: !input.agent_id, deadline: Date.now() + BUDGET_MS, infos: new Map() };
	const tin = input.tool_input || {};
	let writes;
	try {
		writes = edit ? editWrites(ctx, tool, tin) : shellWrites(ctx, String(tin.command || ''));
	} catch (e) {
		if (e instanceof Unresolved) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Held: ${e.message}` } };
		throw e;
	}
	for (const w of writes) {
		const reason = judge(ctx, w);
		if (reason) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
	}
	return null;
}

module.exports = { check };
