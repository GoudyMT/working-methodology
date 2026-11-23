#!/usr/bin/env node
// K300/K301 (build 24): the handoff record and its gate. Found in the handoff-cost study: over 3 to 5 hops on a small
// model, prose dropped severities and paths, and a JSONL record kept every finding; one retry with the exact errors
// repaired most broken records. A hand-back is prose, a line `RECORD:`, then one JSON object per line. A plain script
// checks it, so any model's output can pass through it, and a `|` in a claim is kept (the old pipe format split it).
//
// Usage: node handoff.mjs check <file|-> [--role <r>] [--commit <c>]     (exit 0 valid, 1 invalid with errors on stderr, 2 unreadable input)
//        node handoff.mjs check --review <unit> [--dir <folder>]          (exit 0 every review finding has a fixed line, 1 not, 2 unreadable)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const FINDING_KEYS = ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix'];
// The statuses a test-reviewer may write (K310). Other roles' statuses are not checked here.
// U20: swap (a test replaced; its replacement names the assertions it keeps), redundant, add (names the break it catches).
const REVIEW_STATUSES = ['wrong-test', 'uncovered', 'passes-on-base', 'vague', 'open', 'swap', 'redundant', 'add'];
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const swapOk = (r) => isObject(r) && filled(r.test) && Array.isArray(r.keeps) && r.keeps.length > 0 && r.keeps.every(filled);
// U16: a tester or test-reviewer states whether its spec was clear, asked (a lead answer must follow) or assumed (refused).
// A missing clarity is a warning in this release (log-only), so only the values are checked as errors.
const CLARITY = ['clear', 'asked', 'assumed'];
// tester or test-reviewer as a word part of the role, in any case.
const CLARITY_ROLE = /(^|[^a-z0-9])(tester|test-reviewer)([^a-z0-9]|$)/i;
// A finding key, plain or decoded from \u escapes.
const FINDING_KEY_RE = new RegExp(`"(${FINDING_KEYS.join('|')})"\\s*:`);
const decodeEscapes = (t) => String(t).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
// K363: a lead's guard ruling ("lead ruling:", any case) rests on a proof: a test file (holds `.test.`) or a probe.
const isRuling = (o) => typeof o.note === 'string' && o.writer === 'lead' && /^\s*lead ruling:/i.test(o.note);
const rulingProofOk = (p) => /\.test\./.test(p) || p.trim().startsWith('probe:');

// A key error names the key in backticks, so a retry prompt can point at exactly the field to repair.
function keyErrors(obj, keys) {
	const errs = [];
	for (const k of keys) {
		if (!(k in obj)) errs.push(`missing \`${k}\``);
		else if (typeof obj[k] !== 'string') errs.push(`non-string \`${k}\``);
		else if (obj[k].trim() === '') errs.push(`empty \`${k}\``);
	}
	return errs;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// True when the first non-blank line after a RECORD: marker is a role line with a valid shape.
function startsWithRole(lines, at) {
	const first = lines.slice(at + 1).find((l) => l.trim() !== '');
	try {
		const o = first === undefined ? null : JSON.parse(first);
		return isObject(o) && keyErrors(o, ['role', 'commit']).length === 0;
	} catch { return false; }
}

// expect: optional { role, commit } the brief named; a commit matches when either one is a prefix of the other.
export function check(text, expect = {}) {
	const out = { ok: false, findings: [], notChecked: 0, notes: 0, errors: [], warnings: [] };
	const lines = String(text).split(/\r?\n/);
	const marks = lines.flatMap((l, i) => (l.trim() === 'RECORD:' ? [i] : []));
	if (!marks.length) {
		out.errors.push('no RECORD: line');
		return out;
	}
	const start = marks[marks.length - 1];
	// An earlier block with a real role line is a second hand-back; a quoted example without one is just prose.
	if (marks.slice(0, -1).some((m) => startsWithRole(lines, m)) && startsWithRole(lines, start)) {
		out.errors.push('two records: the text holds more than one RECORD: block with a role line');
		return out;
	}
	const seen = new Set();
	const notes = [];
	let roleDone = false;
	let roleObj = null;
	lines.slice(start + 1).forEach((raw, i) => {
		if (raw.trim() === '') return;
		const n = i + 1;
		const fail = (msg) => out.errors.push(`line ${n}: ${msg}`);
		const isRole = !roleDone;
		roleDone = true;
		let obj;
		try { obj = JSON.parse(raw); } catch { return fail('not valid JSON'); }
		if (isRole) {
			const errs = isObject(obj) ? keyErrors(obj, ['role', 'commit']) : ['missing `role`'];
			if (errs.length === 0 && !/^[0-9a-f]{7,40}$/i.test(obj.commit)) errs.push('bad `commit`, want 7 to 40 hex characters');
			if (errs.length === 0) {
				if (expect.role !== undefined && obj.role !== expect.role) errs.push(`\`role\` is ${obj.role}, the brief named ${expect.role}`);
				const c = expect.commit;
				if (c !== undefined && !obj.commit.startsWith(c) && !c.startsWith(obj.commit)) errs.push(`\`commit\` is ${obj.commit}, the brief named ${c}`);
			}
			if (isObject(obj)) out.roleLine = obj;
				// A finding's keys go on their own line.
				const merged = isObject(obj) ? FINDING_KEYS.filter((k) => k in obj) : [];
				if (merged.length) errs.push(`the role line holds finding key ${merged.join(', ')}: a finding goes on its own line`);
				if (isObject(obj) && typeof obj.role === 'string' && CLARITY_ROLE.test(obj.role)) {
				roleObj = obj;
				if (!('clarity' in obj)) out.warnings.push(`line ${n}: missing clarity (log-only in this release)`);
				else if (!CLARITY.includes(obj.clarity)) fail(`bad \`clarity\` ${JSON.stringify(obj.clarity)}, want one of ${CLARITY.join(', ')}`);
				else if (obj.clarity === 'assumed') fail('`clarity` is "assumed": assumed without a lead answer is refused; stop and ask the lead');
			}
			errs.forEach(fail);
			return;
		}
		if (!isObject(obj)) return fail('unknown line shape');
		const hasOther = ['notChecked', 'note'].some((k) => k in obj);
		const ruling = 'note' in obj && isRuling(obj);
		if (hasOther && FINDING_KEYS.some((k) => k in obj && !(ruling && k === 'proof'))) return fail('unknown line shape, mixes finding and note keys');
		if ('notChecked' in obj) {
			const errs = keyErrors(obj, ['notChecked']);
			errs.forEach(fail);
			if (!errs.length) out.notChecked++;
		} else if ('note' in obj) {
			const errs = keyErrors(obj, ruling ?['note', 'writer', 'proof'] : ['note', 'writer']);
			if (ruling && typeof obj.proof === 'string' && obj.proof.trim() !== '' && !rulingProofOk(obj.proof)) {
				errs.push('`proof` must name a test file (holds `.test.`) or start with `probe:`');
			}
			errs.forEach(fail);
			if (!errs.length) { out.notes++; notes.push(obj); }
		} else if (FINDING_KEYS.some((k) => k in obj)) {
			const errs = keyErrors(obj, FINDING_KEYS);
			// A whole placeholder (<...> with nothing else) is a template line copied without its values.
			for (const k of FINDING_KEYS) {
				if (typeof obj[k] === 'string' && /^<[^<>]*>$/.test(obj[k].trim())) errs.push(`\`${k}\` is an unfilled placeholder`);
			}
			if (typeof obj.severity === 'string' && obj.severity && !SEVERITIES.includes(obj.severity)) {
				errs.push(`bad \`severity\`, want one of ${SEVERITIES.join(', ')}`);
			}
			if (expect.role === 'test-reviewer' && typeof obj.status === 'string' && obj.status && !REVIEW_STATUSES.includes(obj.status)) {
				errs.push(`bad \`status\` ${JSON.stringify(obj.status)}, want one of ${REVIEW_STATUSES.join(', ')}`);
			}
			if (expect.role === 'test-reviewer' && obj.status === 'add' && !filled(obj.breaks)) errs.push('`breaks` is missing or empty: an add names the break it catches');
			if (expect.role === 'test-reviewer' && obj.status === 'swap' && !swapOk(obj.replacement)) {
				errs.push('`replacement` must be {"test": "<name>", "keeps": [<assertions the swap keeps>]}, with at least one kept assertion');
			}
			if (typeof obj.id === 'string' && obj.id) {
				if (seen.has(obj.id)) errs.push(`duplicate \`id\` ${JSON.stringify(obj.id)}`);
				seen.add(obj.id);
			}
			errs.forEach(fail);
			if (!errs.length) out.findings.push(obj);
		} else fail('unknown line shape');
	});
	if (roleObj && roleObj.clarity === 'asked' && !notes.some((o) => o.writer === 'lead' && /^lead answer:\s*\S/.test(o.note))) {
		out.errors.push('clarity is asked, so the lead must answer: a line {"note":"lead answer: <text>","writer":"lead"}');
	}
	// A role line alone is not a hand-back; only said when nothing else is wrong, so it adds no noise.
	if (!out.findings.length && !out.notChecked && !out.notes && !out.errors.length) out.errors.push('the record is empty: no finding, notChecked or note');
	out.ok = out.errors.length === 0;
	return out;
}

// Ids of the findings in each RECORD block but the last; null when one has no id.
function earlierIds(text) {
	const lines = String(text).split(/\r?\n/);
	const marks = lines.flatMap((l, i) => (l.trim() === 'RECORD:' ? [i] : []));
	const ids = [];
	for (let k = 0; k < marks.length - 1; k++) {
		const body = decodeEscapes(lines.slice(marks[k] + 1, marks[k + 1]).join('\n'));
		if (!FINDING_KEY_RE.test(body)) continue;
		const found = [...body.matchAll(/"id"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
		if (!found.length) return null;
		ids.push(...found);
	}
	return ids;
}

// A finding above the last RECORD: line, in any shape.
export const findingAbove = (text) => /^\s*(critical|high|medium|low)\s*\|/m.test(text) || FINDING_KEY_RE.test(decodeEscapes(text));

// The role line names the brief's role (any case) and its head (a case-insensitive prefix).
export const namedBy = (line, want) => Boolean(line && want.role !== undefined && want.commit) && String(line.role).toLowerCase() === String(want.role).toLowerCase() && String(want.commit).toLowerCase().startsWith(String(line.commit).toLowerCase());

const UNIT_BAD =/[\\/]|\.\./;

// The review folder: kit-reviews under the git common dir, so a linked worktree reads the main repo's. Git is launched
// as pr-size.mjs launches it: from node's own folder, with a git.exe left in the folder never run in its place.
function defaultFolder() {
	const r = spawnSync('git', ['-C', process.cwd(), '-c', 'core.fsmonitor=false', 'rev-parse', '--git-common-dir'], {
		encoding: 'utf8',
		timeout: 60000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
	});
	return r.status === 0 ? path.join(path.resolve(process.cwd(), r.stdout.trim()), 'kit-reviews') : null;
}

// The file's text, undefined when there is no such file. A file that is there but cannot be read throws.
function readOptional(file) {
	try { return fs.readFileSync(file, 'utf8'); } catch (e) {
		if (e.code === 'ENOENT') return undefined;
		throw new Error(`cannot read ${file}: ${e.code || e.message}`);
	}
}

// check --review <unit> (K310): each review finding needs a `fixed` line with the same id in the tester's fix record.
function reviewGate(unit, dirArg) {
	if (unit.trim() === '' || UNIT_BAD.test(unit)) {
		console.error(`unit ${JSON.stringify(unit)} is not a plain name: no path separator, no .., not empty`);
		return 2;
	}
	const folder = dirArg ?? defaultFolder();
	if (folder === null) {
		console.error('check --review: not inside a git repository, so there is no default folder; pass --dir <folder>');
		return 2;
	}
	let review, fix;
	try {
		review = readOptional(path.join(folder, `${unit}.review.jsonl`));
		fix = readOptional(path.join(folder, `${unit}.fix.jsonl`));
	} catch (e) {
		console.error(e.message);
		return 2;
	}
	if (review === undefined) {
		console.error(`no review for ${unit}`);
		return 1;
	}
	const rv = check(review, { role: 'test-reviewer' });
	if (!rv.ok) {
		console.error(rv.errors.join('\n'));
		return 1;
	}
	const fx = fix === undefined ? { ok: true, findings: [] } : check(fix, { role: 'tester' });
	if (!fx.ok) {
		console.error(fx.errors.join('\n'));
		return 1;
	}
	const fixed = new Set(fx.findings.filter((f) => f.status === 'fixed').map((f) => f.id));
	// Every RECORD block counts, not only the last.
		const early = earlierIds(review);
		if (early === null) {
			console.error('an earlier RECORD: block has a finding with no `id`');
			return 1;
		}
		const ids = [...rv.findings.map((f) => f.id), ...early];
		const unfixed = ids.filter((id) => !fixed.has(id));
	for (const id of unfixed) console.error(`unfixed: review finding ${id} has no fixed line in ${unit}.fix.jsonl`);
	if (unfixed.length) return 1;
	console.log(`ok: ${ids.length} review findings, all fixed`);
	return 0;
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const expect = {};
	let file;
	let review;
	let dir;
	for (let i = 0; i < rest.length; i++) {
		const flag = rest[i];
		if (['--role', '--commit', '--review', '--dir'].includes(flag)) {
			const v = rest[++i];
			if (v === undefined) {
				console.error(`${flag} needs a value`);
				return 2;
			}
			if (flag === '--review') review = v;
			else if (flag === '--dir') dir = v;
			else expect[flag.slice(2)] = v;
		} else if (file === undefined) file = rest[i];
		else file = null;
	}
	const usage = () => {
		console.error('usage: node handoff.mjs check <file|-> [--role <r>] [--commit <c>]  |  check --review <unit> [--dir <folder>]');
		return 2;
	};
	if (cmd !== 'check') return usage();
	if (review !== undefined) return file === undefined ? reviewGate(review, dir) : usage();
	if (!file || dir !== undefined) return usage();
	let text;
	try { text = fs.readFileSync(file === '-' ? 0 : file, 'utf8'); } catch (e) {
		console.error(`cannot read ${file}: ${e.code || e.message}`);
		return 2;
	}
	const r = check(text, expect);
	r.warnings.forEach((w) => console.error(w));
	if (!r.ok) {
		console.error(r.errors.join('\n'));
		return 1;
	}
	console.log(`ok: ${r.findings.length} findings, ${r.notChecked} notChecked, ${r.notes} notes`);
	return 0;
}

// Run only when started directly, never when a test or tool imports check.
// Real paths on both sides, so a run through a junction or symlink still checks.
function runDirectly() {
	try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (runDirectly()) process.exitCode = main(process.argv.slice(2));
