#!/usr/bin/env node
// K300/K301 (build 24): the handoff record and its gate. Found in the handoff-cost study: over 3 to 5 hops on a small
// model, prose dropped severities and paths, and a JSONL record kept every finding; one retry with the exact errors
// repaired most broken records. A hand-back is prose, a line `RECORD:`, then one JSON object per line. A plain script
// checks it, so any model's output can pass through it, and a `|` in a claim is kept (the old pipe format split it).
//
// Usage: node handoff.mjs check <file|->     (exit 0 valid, 1 invalid with errors on stderr, 2 unreadable input)
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

export function check(text) {
	const out = { ok: false, findings: [], notChecked: 0, notes: 0, errors: [] };
	const lines = String(text).split(/\r?\n/);
	const start = lines.findIndex((l) => l.trim() === 'RECORD:');
	if (start < 0) {
		out.errors.push('no RECORD: line');
		return out;
	}
	const seen = new Set();
	let roleDone = false;
	lines.slice(start + 1).forEach((raw, i) => {
		if (raw.trim() === '') return;
		const n = i + 1;
		const fail = (msg) => out.errors.push(`line ${n}: ${msg}`);
		let obj;
		try { obj = JSON.parse(raw); } catch { return fail('not valid JSON'); }
		if (!roleDone) {
			roleDone = true;
			const errs = isObject(obj) ? keyErrors(obj, ['role', 'commit']) : ['missing `role`'];
			if (errs.length === 0 && !/^[0-9a-f]{7,40}$/i.test(obj.commit)) errs.push('bad `commit`, want 7 to 40 hex characters');
			errs.forEach(fail);
			return;
		}
		if (!isObject(obj)) return fail('unknown line shape');
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
				if (seen.has(obj.id)) errs.push(`duplicate \`id\` ${obj.id}`);
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
	const [cmd, file] = argv;
	if (cmd !== 'check' || !file) {
		console.error('usage: node handoff.mjs check <file|->');
		return 2;
	}
	let text;
	try { text = fs.readFileSync(file === '-' ? 0 : file, 'utf8'); } catch (e) {
		console.error(`cannot read ${file}: ${e.code || e.message}`);
		return 2;
	}
	const r = check(text);
	if (!r.ok) {
		console.error(r.errors.join('\n'));
		return 1;
	}
	console.log(`ok: ${r.findings.length} findings, ${r.notChecked} notChecked, ${r.notes} notes`);
	return 0;
}

// Run only when started directly, never when a test or tool imports check.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
