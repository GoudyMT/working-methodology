// K399 U21 (patch 1.51.4): the CI failure digest and the helpers the CI state file needs. ci-wait.mjs writes the state
// with it and ci-fix.mjs reads it (list, digest, diagnose, fix). One module, two copies, byte for byte:
// project/.claude/ci-digest.mjs and user/kit-tools/ci-digest.mjs (scripts/kit.mjs writes the copy, since an installed
// kit holds user/ only). Reads are plain fs reads; gh is reached only through a runner the caller gives, and the
// default runner starts gh from node's own folder, as ci-wait always has.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Jobs that only gather the others' results: a rollup is dropped, never read as a failure of its own.
export const ROLLUP_NAMES = ['kit-tests', 'test-check (all)'];
const ROLLUP_STEP = /^Every .+ passed$/;
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const FRAME = /((?:scripts|tests|src|project|user|\.github|docs)\/[^\s():'"]+?\.(?:mjs|cjs|js|yml|json)):(\d+)/;
const LOCATION = /(tests\/[^\s':]+?\.test\.mjs):(\d+)/;
const TAP_NOT_OK = /^\s*not ok \d+ - (.+)$/;
const TAP_BREAK = /^\s*(?:not )?ok \d+ - |^\s*# Subtest:|^1\.\.\d+|^# (?:tests|pass|fail)\b/;
const TEMP = /temp growth: (\d+) in /;
const CAP = /over the cap: .*?(tests\/[^\s,]+\.test\.mjs), (\d+) ms \(cap (\d+) ms\)/;
const ERROR_LINE = /^(\w*Error): (.+)$/;
const CHECK = /^test check: (.+)$/;
const STALE = /^(\S+) is stale: run (.+)$/;
const SCORE = /score gate: (.+)$/;

export function readText(file) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

// A log as lines: colour codes, carriage returns and the runner's timestamps taken off.
export function cleanLog(text) {
	return String(text ?? '').replace(ANSI, '').replace(/\r/g, '').split('\n').map((l) => l.replace(STAMP, '').replace(/\s+$/, ''));
}

function tapItems(lines) {
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const m = TAP_NOT_OK.exec(lines[i]);
		if (!m) continue;
		let end = i + 1;
		while (end < lines.length && !TAP_BREAK.test(lines[end])) end++;
		const block = lines.slice(i + 1, end);
		const loc = block.map((l) => LOCATION.exec(l)).find(Boolean);
		const err = block.map((l) => /^\s*error: '(.*)'\s*$/.exec(l)).find(Boolean);
		out.push({ shape: 'test', name: m[1].trim(), file: loc ? loc[1] : '', line: loc ? Number(loc[2]) : 0, message: err ? err[1] : m[1].trim() });
	}
	return out;
}

function gateItems(lines) {
	const out = [];
	for (const l of lines) {
		if (TEMP.test(l)) out.push({ shape: 'gate', name: 'temp-growth', file: '', line: 0, message: l.trim() });
		const c = CAP.exec(l);
		if (c) out.push({ shape: 'gate', name: 'fast-cap', file: c[1], line: 0, message: l.trim() });
	}
	return out;
}

function crashItems(lines) {
	const out = [];
	const err = lines.find((l) => ERROR_LINE.test(l) && !/^\s/.test(l));
	if (!err) return out;
	const frame = lines.map((l) => FRAME.exec(l)).find(Boolean);
	out.push({ shape: 'crash', name: 'crash', file: frame ? frame[1] : '', line: frame ? Number(frame[2]) : 0, message: err.trim() });
	return out;
}

// Test-check findings come as one line each; lines with one reason are one item with its count.
function checkItems(lines) {
	const groups = new Map();
	for (const l of lines) {
		const m = CHECK.exec(l);
		if (!m || /finding\(s\)$/.test(m[1])) continue;
		const body = m[1];
		const s = body.replace(/^R\d+: /, '').replace(/^[\w./-]+\.test\.mjs::[^:]*: /, '').replace(/ \([^)]*\)/, '');
		const reason = ((/^A\d+: ([^:]+)/.exec(s) || /^([^:]+)/.exec(s))[1]).trim();
		const file = (/(tests\/[^\s:()]+\.test\.mjs)/.exec(body) || [, ''])[1];
		const g = groups.get(reason) || { shape: 'check', name: reason, file, line: 0, message: body, count: 0 };
		g.count++;
		groups.set(reason, g);
	}
	return [...groups.values()];
}

function staleItems(lines) {
	const out = [];
	for (const l of lines) {
		const m = STALE.exec(l);
		if (m) out.push({ shape: 'check', name: m[1].replace(/^.*\//, '').replace(/\.[^.]+$/, ''), file: m[1], line: 0, message: l.trim() });
	}
	return out;
}

function scoreItems(lines) {
	return lines.filter((l) => SCORE.test(l)).map((l) => ({ shape: 'gate', name: 'score-gate', file: '', line: 0, message: l.trim() }));
}

function tail(lines) {
	return lines.filter((l) => l.trim() !== '').slice(-25).join('\n');
}

// The items of one job's log: each shape it knows. A log with none gives one unparsed item, so no failed job goes uncounted.
export function parseLog(text) {
	const lines = cleanLog(text);
	const found = [...tapItems(lines), ...gateItems(lines), ...crashItems(lines), ...checkItems(lines), ...staleItems(lines), ...scoreItems(lines)];
	return found.length ? found : [{ shape: 'unparsed', name: 'unparsed', file: '', line: 0, message: tail(lines) }];
}

// The kind: fixable (a fixer exists), escalate (the owner's: a score gate miss, a security finding, an unreported required
// check, or an item diagnosed in an earlier run that is red again), else diagnose.
function kindOf(it, key, prior) {
	if (prior.has(key)) return 'escalate';
	if (/score gate:/.test(it.message) || /security/i.test(it.message)) return 'escalate';
	if (/required check/i.test(it.message) && /unreported|not reported/i.test(it.message)) return 'escalate';
	if (it.shape === 'check' && /scripts\/rule-map\.mjs write/.test(it.message)) return 'fixable';
	return 'diagnose';
}

const failedStep = (job) => (Array.isArray(job.steps) ? job.steps.find((s) => s && s.conclusion === 'failure') : undefined);
// A job that ended any way but green or skipped is a failed job: a timeout, a cancel and a start failure are never read as none.
const FAILED = ['failure', 'timed_out', 'cancelled', 'startup_failure'];

/**
 * The digest of a run's jobs (the jobs API shape).
 *
 * Args:
 *     doc: { jobs: [...] } as the jobs API returns it
 *     readLog(job): the job's log text, or null when it cannot be read
 *     prior: a Set of keys that a cifix line already names (an item red again is escalate)
 *
 * Returns:
 *     { items, jobsFailed, jobsCovered } - items numbered from 1, key `<job>::<name>`; jobsCovered counts the failed
 *     jobs (rollups left out) that gave at least one item
 */
export function digest(doc, readLog, prior = new Set()) {
	const jobs = Array.isArray(doc?.jobs) ? doc.jobs : [];
	const failed = jobs.filter((j) => j && FAILED.includes(j.conclusion));
	const items = [];
	const seen = new Map();
	let covered = 0;
	for (const job of failed) {
		const step = failedStep(job);
		if (ROLLUP_NAMES.includes(job.name) || (step && ROLLUP_STEP.test(step.name))) continue;
		covered++;
		for (const it of parseLog(readLog(job) ?? '')) {
			if (it.shape === 'unparsed' && job.conclusion !== 'failure') it.message = `the job ${job.conclusion}${it.message ? `: ${it.message}` : ''}`;
			const base = `${job.name}::${it.name}`;
			const k = (seen.get(base) || 0) + 1;
			seen.set(base, k);
			const key = k === 1 ? base : `${base} #${k}`;
			items.push({ n: items.length + 1, key, shape: it.shape, job: String(job.name), step: step ? String(step.name) : '', file: it.file, line: it.line, name: it.name, message: it.message, count: it.count || 1, kind: kindOf(it, key, prior) });
		}
	}
	return { items, jobsFailed: failed.length, jobsCovered: covered };
}

/** The git folders of the repo that holds start: the folder with .git, its git dir, and the common dir (fs reads only). */
export function gitDirs(start) {
	let dir = path.resolve(String(start));
	for (;;) {
		const dotgit = path.join(dir, '.git');
		let st = null;
		try {
			st = fs.statSync(dotgit);
		} catch {
			/* no .git here: look in the folder above */
		}
		if (st) {
			let gitdir = dotgit;
			if (!st.isDirectory()) {
				const m = /^gitdir: (.+)$/m.exec(readText(dotgit) || '');
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

/** The full sha HEAD names, read from the files (a loose ref, else packed-refs); null when none can be read. */
export function headSha(start) {
	const d = gitDirs(start);
	if (!d) return null;
	const head = readText(path.join(d.gitdir, 'HEAD'));
	if (head === null) return null;
	const h = head.trim();
	const m = /^ref: (.+)$/.exec(h);
	if (!m) return /^[0-9a-f]{40}$/i.test(h) ? h : null;
	const ref = m[1].trim();
	const loose = readText(path.join(d.common, ref));
	if (loose !== null) return loose.trim();
	for (const line of (readText(path.join(d.common, 'packed-refs')) || '').split('\n')) {
		const p = line.trim().split(' ');
		if (p[1] === ref) return p[0];
	}
	return null;
}

/** The cifix record of the repo at root: { version, file, lines }. A repo with no VERSION has none (version null). Throws on a bad line. */
export function readCifix(root) {
	const v = readText(path.join(root, 'VERSION'));
	if (v === null) return { version: null, file: null, lines: [] };
	const version = v.trim();
	const file = path.join(root, 'docs', 'builds', `${version}.cifix.jsonl`);
	const text = readText(file);
	if (text === null) return { version, file, lines: [] };
	const lines = text.split('\n').filter((l) => l.trim() !== '').map((l, i) => {
		try {
			return JSON.parse(l);
		} catch {
			throw new Error(`${path.basename(file)} line ${i + 1} is not readable JSON`);
		}
	});
	return { version, file, lines };
}

// The gate words and the per-line compare (F4): one home, read by ci-fix.cjs (the edit hold) and closeout.mjs (the backstop).
// A gate file holds a cap or a floor; a line is a cap, a floor, or mixed (it holds both kinds, so it is held on any change).
export const GATE_FILE = /^(\.github\/workflows\/[^/]+\.yml|tests\/harness\.mjs|scripts\/test-run\.mjs|scripts\/test-check\.mjs|\.claude\/bounds\.json|(?:.*\/)?model-floors\.json)$/;
// The same names found anywhere in a command's text (an unclear write that names one is held), and the cifix record.
export const GATE_TEXT = /(?:\.github\/workflows\/[^/\s"']+\.yml|tests\/harness\.mjs|scripts\/test-run\.mjs|scripts\/test-check\.mjs|\.claude\/bounds\.json|model-floors\.json|docs\/builds\/[^/\s"']+\.cifix\.jsonl)/i;
export const TEST_FILE = /^tests\/.+\.test\.mjs$/;
const wordIn = (words) => new RegExp(`(?:^|[^a-z])(?:${words})(?:[^a-z]|$)`, 'i');
// A word matches whole: "capture" is no cap, "FAST_CAP_MS" is one (the _MS suffix).
const CAP_WORD = new RegExp(`${wordIn('timeout|budget|limit|cap|max|margin|minutes|seconds').source}|_MS(?![a-z])`, 'i');
const FLOOR_WORD = wordIn('min|floor|score|threshold|median');
export const NUM = /\d+(?:\.\d+)?/g;

/**
 * A gate line's text with its comment taken off: numbers in a comment are never compared. A comment mark inside a quoted
 * string is text, not a comment (F4); a line whose quotes do not close is kept whole, so it fails closed.
 */
export function codeOf(file, text) {
	const s = String(text);
	const yaml = /\.ya?ml$/i.test(file);
	let out = '';
	let quote = null;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === '\\') {
				out += s.slice(i, i + 2);
				i++;
				continue;
			}
			if (c === quote) quote = null;
			out += c;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			quote = c;
			out += c;
			continue;
		}
		if (yaml ? c === '#' && (i === 0 || /\s/.test(s[i - 1])) : c === '/' && s[i + 1] === '/' && (i === 0 || /\s/.test(s[i - 1]))) break;
		if (!yaml && c === '/' && s[i + 1] === '*' && s.indexOf('*/', i + 2) >= 0) {
			out += ' ';
			i = s.indexOf('*/', i + 2) + 1;
			continue;
		}
		out += c;
	}
	return (quote === null ? out : s).replace(/\s+$/, '');
}

/**
 * The cap or floor a line of a gate file holds.
 *
 * Returns:
 *     { kind: 'cap' | 'floor' | 'mixed', text, key, nums } or null (not a gate line, or no number on it). Math.min( reads as a cap
 *     and Math.max( as a floor, before the word lists (F3); a line with both kinds is mixed. key is the code with every number
 *     as #, so the same line in two versions pairs up.
 */
export function gateLine(file, raw) {
	const f = String(file);
	const text = codeOf(f, raw);
	let kind = null;
	if (TEST_FILE.test(f)) kind = /timeout:\s*\d/.test(text) ? 'cap' : null;
	else if (GATE_FILE.test(f)) {
		const words = text.replace(/Math\.(?:max|min)\(/g, ' ');
		const floor = /Math\.max\(/.test(text) || FLOOR_WORD.test(words);
		const cap = /Math\.min\(/.test(text) || CAP_WORD.test(words);
		const calls = /Math\.(?:max|min)\(/.test(text);
		// A call decides its own kind first; a word of the other kind beside it, or a call of the other kind, makes it mixed.
		if (calls) kind = /Math\.max\(/.test(text) && /Math\.min\(/.test(text) ? 'mixed' : /Math\.max\(/.test(text) ? (CAP_WORD.test(words) ? 'mixed' : 'floor') : (FLOOR_WORD.test(words) ? 'mixed' : 'cap');
		else kind = cap && floor ? 'mixed' : cap ? 'cap' : floor ? 'floor' : null;
	}
	const nums = (text.match(NUM) || []).map(Number);
	if (!kind || nums.length === 0) return null;
	return { kind, text: String(raw).trim(), key: text.replace(NUM, '#').trim(), nums };
}

/** The place of the first number on a line that loosens the gate against its old numbers (cap up, floor down, mixed: any change), or -1. */
export function loosened(kind, was, now) {
	// A count of numbers that changed is a loosening for every kind (ruling 8), as a mixed line's any change is.
	if (was.length !== now.length) return 0;
	if (kind === 'mixed') return now.findIndex((n, k) => n !== was[k]);
	return now.findIndex((n, k) => k < was.length && (kind === 'cap' ? n > was[k] : n < was[k]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Max's latest answer to a pop-up that quotes one of the acts, read only through owner-yes.cjs's reader (exact act span, one
 * act per question, exact Yes, latest answer wins). The session is sid (CLAUDE_CODE_SESSION_ID when not given) and must be a
 * plain UUID.
 *
 * Returns:
 *     { yes, id, at, act } for the newest answer (id is the pop-up's tool-use id, the grant; act is the act it quoted), or null
 *     when no pop-up quotes an act or the session cannot be read. yes is true only for a Yes to a question that quotes that act alone.
 */
export function popUpAnswer(acts, root, sid = process.env.CLAUDE_CODE_SESSION_ID) {
	if (!UUID.test(String(sid || ''))) return null;
	const { sessionLatest } = createRequire(import.meta.url)('./owner-yes.cjs');
	let best = null;
	let bestAct = null;
	for (const act of acts) {
		const y = sessionLatest(act, { sessionId: sid, repo: root });
		if (y && (!best || y.at > best.at)) {
			best = y;
			bestAct = act;
		}
	}
	return best ? { yes: best.yes && best.single, id: best.tap.slice(sid.length + 1), at: best.at, act: bestAct } : null;
}

/** Whether a session's pop-up record can be read here: a session id is given and its transcript is kept for this repo or above. */
export function popUpReadable(root, sid = process.env.CLAUDE_CODE_SESSION_ID) {
	if (!sid) return false;
	const { sessionGap } = createRequire(import.meta.url)('./owner-yes.cjs');
	return sessionGap({ sessionId: sid, repo: root }) === '';
}

/** The acts a pop-up may quote for an attempt-2 grant on an item: the full act, or the item's key alone. */
export const attempt2Acts = (key) => [`ci-fix attempt-2 ${key}`, String(key)];

/** Whether a pop-up answer is still fresh enough to act on (owner-yes.cjs's own limit). */
export function popUpFresh(answer, now = Date.now()) {
	const { FRESH_MS } = createRequire(import.meta.url)('./owner-yes.cjs');
	return !!answer && now - answer.at >= 0 && now - answer.at <= FRESH_MS;
}

/** The default gh runner: gh from node's own folder (never a project's gh.exe), with a time limit. */
export function ghRun(args) {
	return spawnSync('gh', args, { cwd: path.dirname(process.execPath), encoding: 'utf8', timeout: 60000, windowsHide: true });
}
