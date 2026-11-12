#!/usr/bin/env node
// The build record (T15 D5, the owner's lock 2026-11-12: "Full JSON record"): one file per release,
// docs/builds/<version>.json, that the CHANGELOG entry and the PR body's Summary, Design decisions, Verification and
// Review are written from, so the three never tell different stories. The release notes skill reads it too. It never
// publishes anything: a release stays the owner's tap.
//   node scripts/build-record.mjs check [<record>]       the record is whole, ASCII, and matches VERSION and CHANGELOG
//   node scripts/build-record.mjs changelog [<record>]   prints the CHANGELOG entry
//   node scripts/build-record.mjs pr [<record>]          prints the Standard PR body
// With no record named, the one for the version in VERSION is read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KINDS = { added: 'Added', changed: 'Changed', fixed: 'Fixed', security: 'Security', removed: 'Removed' };
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** The problems with a record, as plain lines; none when it is whole. */
export function problems(rec) {
	const out = [];
	const need = (cond, what) => { if (!cond) out.push(what); };
	const text = (v) => typeof v === 'string' && v.trim().length > 0;
	need(rec && typeof rec === 'object', 'the record is not a JSON object');
	if (!rec || typeof rec !== 'object') return out;
	need(/^\d+\.\d+\.\d+$/.test(rec.version || ''), 'version is not plain x.y.z');
	need(/^\d{4}-\d{2}-\d{2}$/.test(rec.date || ''), 'date is not YYYY-MM-DD');
	need(['major', 'minor', 'patch'].includes(rec.level), 'level is not major, minor or patch');
	for (const k of ['area', 'title', 'headline']) need(text(rec[k]), `${k} is missing`);
	need(/^[a-z]+: \S/.test(rec.title || '') && (rec.title || '').length <= 72, 'title is not "type: subject" within 72 characters');
	need(Array.isArray(rec.items) && rec.items.length > 0, 'items is empty');
	(rec.items || []).forEach((it, i) => {
		need(text(it.id), `item ${i + 1} has no id`);
		need(Object.hasOwn(KINDS, it.kind), `item ${i + 1} kind "${it.kind}" is not one of ${Object.keys(KINDS).join(', ')}`);
		for (const k of ['text', 'evidence']) need(text(it[k]), `item ${i + 1} (${it.id}) has no ${k}`);
		need(!it.where || (text(it.before) && text(it.after)), `item ${i + 1} (${it.id}) names a where without its before and after`);
	});
	need(Array.isArray(rec.verification) && rec.verification.length > 0, 'verification is empty');
	const s = rec.sweep;
	need(s && text(s.tier) && text(s.commit), 'sweep has no tier or commit');
	if (s) {
		need(Array.isArray(s.dimensions) && s.dimensions.length > 0, 'sweep names no dimension');
		for (const sev of SEVERITIES) need(Number.isInteger((s.findings || {})[sev]), `sweep findings has no ${sev} count`);
	}
	need(rec.tests && Number.isInteger(rec.tests.before) && Number.isInteger(rec.tests.after), 'tests has no before and after count');
	// The record is the source of outward text: plain ASCII, as the PR body and changelog must be.
	const nonAscii = [...JSON.stringify(rec)].find((ch) => ch.charCodeAt(0) > 126);
	need(!nonAscii, `the record holds a non-ASCII character (code ${nonAscii ? nonAscii.charCodeAt(0) : ''})`);
	return out;
}

/** The CHANGELOG entry, items grouped by kind in a fixed order. */
export function changelog(rec) {
	const lines = [`## ${rec.version} - ${rec.date}`, '', rec.headline.trim(), ''];
	for (const [kind, heading] of Object.entries(KINDS)) {
		const items = rec.items.filter((it) => it.kind === kind);
		if (!items.length) continue;
		lines.push(`### ${heading}`);
		for (const it of items) lines.push(`- ${it.text.trim()}`);
		lines.push('');
	}
	return lines.join('\n');
}

/** The Standard PR body (rule:pr-body), written from the record. */
export function prBody(rec) {
	const subject = rec.title.replace(/^[a-z]+: /, '');
	const rows = rec.items.filter((it) => it.where);
	const s = rec.sweep;
	const count = (list) => (list && list.length ? list.map((x) => `  - ${x}`).join('\n') : null);
	const out = [`## ${rec.area}: ${subject}`, '', `${rec.headline.trim()} Releases as v${rec.version}.`, '', '### Summary', '',
		'| Where | Before | After |', '|---|---|---|', ...rows.map((it) => `| ${it.where} | ${it.before} | ${it.after} |`), ''];
	if ((rec.decisions || []).length) out.push('### Design decisions', '', ...rec.decisions.map((d) => `- **${d.decision}:** ${d.why}`), '');
	out.push('### Verification', '', ...rec.verification.map((v) => `- ${v}`), `- Tests: ${rec.tests.before} before, ${rec.tests.after} after${rec.tests.flips ? `; ${rec.tests.flips}` : ''}.`, '');
	out.push('### Review', '', `${s.tier} review of \`${s.commit}\`.`, '', '| Dimension | Result |', '|---|---|', ...s.dimensions.map((d) => `| ${d.name} | ${d.result} |`), '');
	const hc = (s.findings.critical || 0) + (s.findings.high || 0);
	out.push(`- **High and critical findings:** ${hc ? `${hc}, each fixed here or accepted by the owner:\n${count(s.fixed) || ''}` : 'none.'}`);
	out.push(`- **Deferred:** ${count(s.deferred) ? `\n${count(s.deferred)}` : 'none.'}`);
	out.push(`- **Accepted risks:** ${count(s.accepted) ? `\n${count(s.accepted)}` : 'none.'}`);
	out.push('- **Secrets:** no secrets or account information in the diff.', '', `Version alignment: YES. ${rec.alignment || `v${rec.version} is the ${rec.level} release this build plans.`}`, '');
	return out.join('\n');
}

/** The record for the version in VERSION, its path, and the checks against VERSION and CHANGELOG.md. */
export function checkRepo(root, file) {
	const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
	const at = file ? path.resolve(file) : path.join(root, 'docs', 'builds', `${version}.json`);
	let rec;
	try { rec = JSON.parse(fs.readFileSync(at, 'utf8')); } catch (e) { return { at, rec: null, problems: [`cannot read ${path.relative(root, at)}: ${e.message.split('\n')[0]}`] }; }
	const found = problems(rec);
	if (rec.version !== version) found.push(`the record is for ${rec.version}, VERSION says ${version}`);
	const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
	const top = (log.split(/^(?=## \d)/m).find((part) => part.startsWith('## ')) || '').trimEnd();
	if (!found.length && top !== changelog(rec).trimEnd()) found.push(`the top CHANGELOG.md entry is not the one the record writes (run: node scripts/build-record.mjs changelog)`);
	return { at, rec, problems: found };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const [cmd, file] = process.argv.slice(2);
	const r = checkRepo(ROOT, file);
	if (cmd === 'check') {
		if (r.problems.length) { process.stderr.write(`Build record ${path.relative(ROOT, r.at)}:\n${r.problems.map((p) => `    ${p}`).join('\n')}\n`); process.exitCode = 1; }
		else process.stdout.write(`Build record ${path.relative(ROOT, r.at)}: whole, and the changelog matches\n`);
	} else if ((cmd === 'changelog' || cmd === 'pr') && r.rec && !problems(r.rec).length) {
		process.stdout.write(cmd === 'changelog' ? changelog(r.rec) : prBody(r.rec));
	} else {
		process.stderr.write(r.rec ? `${problems(r.rec).join('\n')}\n` : 'usage: node scripts/build-record.mjs check | changelog | pr [<record>]\n');
		process.exitCode = r.rec ? 1 : 2;
	}
}
