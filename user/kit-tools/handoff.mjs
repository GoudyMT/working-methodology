#!/usr/bin/env node
// K300/K301 (build 24): the handoff record and its gate. Found in the handoff-cost study: over 3 to 5 hops on a small
// model, prose dropped severities and paths, and a JSONL record kept every finding; one retry with the exact errors
// repaired most broken records. A hand-back is prose, a line `RECORD:`, then one JSON object per line. A plain script
// checks it, so any model's output can pass through it, and a `|` in a claim is kept (the old pipe format split it).
//
// Usage: node handoff.mjs check <file|-> [--role <r>] [--commit <c>]     (exit 0 valid, 1 invalid with errors on stderr, 2 unreadable input)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const FINDING_KEYS = ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix'];

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
	const out = { ok: false, findings: [], notChecked: 0, notes: 0, errors: [] };
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
	let roleDone = false;
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
			errs.forEach(fail);
			return;
		}
		if (!isObject(obj)) return fail('unknown line shape');
		const hasOther = ['notChecked', 'note'].some((k) => k in obj);
		if (hasOther && FINDING_KEYS.some((k) => k in obj)) return fail('unknown line shape, mixes finding and note keys');
		if ('notChecked' in obj) {
			const errs = keyErrors(obj, ['notChecked']);
			errs.forEach(fail);
			if (!errs.length) out.notChecked++;
		} else if ('note' in obj) {
			const errs = keyErrors(obj, ['note', 'writer']);
			errs.forEach(fail);
			if (!errs.length) out.notes++;
		} else if (FINDING_KEYS.some((k) => k in obj)) {
			const errs = keyErrors(obj, FINDING_KEYS);
			if (typeof obj.severity === 'string' && obj.severity && !SEVERITIES.includes(obj.severity)) {
				errs.push(`bad \`severity\`, want one of ${SEVERITIES.join(', ')}`);
			}
			if (typeof obj.id === 'string' && obj.id) {
				if (seen.has(obj.id)) errs.push(`duplicate \`id\` ${JSON.stringify(obj.id)}`);
				seen.add(obj.id);
			}
			errs.forEach(fail);
			if (!errs.length) out.findings.push(obj);
		} else fail('unknown line shape');
	});
	// A role line alone is not a hand-back; only said when nothing else is wrong, so it adds no noise.
	if (!out.findings.length && !out.notChecked && !out.notes && !out.errors.length) out.errors.push('the record is empty: no finding, notChecked or note');
	out.ok = out.errors.length === 0;
	return out;
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const expect = {};
	let file;
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--role' || rest[i] === '--commit') {
			const v = rest[++i];
			if (v === undefined) {
				console.error(`${rest[i - 1]} needs a value`);
				return 2;
			}
			expect[rest[i - 1].slice(2)] = v;
		} else if (file === undefined) file = rest[i];
		else file = null;
	}
	if (cmd !== 'check' || !file) {
		console.error('usage: node handoff.mjs check <file|-> [--role <r>] [--commit <c>]');
		return 2;
	}
	let text;
	try { text = fs.readFileSync(file === '-' ? 0 : file, 'utf8'); } catch (e) {
		console.error(`cannot read ${file}: ${e.code || e.message}`);
		return 2;
	}
	const r = check(text, expect);
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
