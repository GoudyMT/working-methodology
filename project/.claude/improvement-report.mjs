#!/usr/bin/env node
// Improvement reports (rule:kit-standards item 12). One format the kit owns for every process or method gap found
// while using it, the same in every project, so the owner can hand a report to the kit as one file and the kit can
// triage it by its fields. Reports live in .kit/reports/ (kit-local, never pushed).
//
// Usage (from the project folder):
//   node .claude/improvement-report.mjs new "<one-line title>"   start a report from the kit template, facts filled in
//   node .claude/improvement-report.mjs audit <report.md>        PASS, or every fault (exit 1)
//   node .claude/improvement-report.mjs list                     the reports and their status
//   node .claude/improvement-report.mjs file <report.md>         hand it to the kit inbox, signed (scripts/intake.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'kit', 'improvement-report.md');
const FIELDS = ['ID', 'Date', 'Project', 'Branch and commit', 'Kit version', 'Type', 'Severity', 'Kit area', 'Status', 'Lesson', 'Closed by'];
const ONE_OF = {
	Type: ['process', 'method', 'both'],
	Severity: ['high', 'medium', 'low'],
	Status: ['open', 'filed', 'accepted', 'declined', 'closed'],
};
const SECTIONS = ['Summary', 'Timeline', 'Root causes', 'Impact', 'Fixes', 'What stays the same', 'Decisions for the owner', 'Proof'];
const KINDS = ['rule text', 'skill step', 'script', 'hook', 'template', 'role file', 'other'];
const EFFECTS = ['same', 'higher'];
// Caps on every free-text part, so a report handed to the kit cannot carry a flood (plan kit-autopilot, Phase 3).
const MAX_BYTES = 64000;
const MAX_FIELD = 200;
const MAX_SECTION = 12000;

const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
// A table row's cells; a pipe inside a code span is part of the cell, not a column break.
function cells(line) {
	const out = [''];
	let code = false;
	for (const ch of line.trim().replace(/^\||\|$/g, '')) {
		if (ch === '`') code = !code;
		if (ch === '|' && !code) out.push('');
		else out[out.length - 1] += ch;
	}
	return out.map((c) => c.trim());
}
// The template's own placeholders: a report that still holds one, even in backticks, is not filled in. Other angle
// brackets (a type like Map<string>, an HTML tag in prose) are content.
const PLACEHOLDERS = () => [...new Set(fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--[\s\S]*?-->/g, '').match(/<[A-Za-z][^<>\n]*>/g) || [])];

// The rows of the first table under a heading (header and divider left out).
function tableUnder(body) {
	const rows = body.split('\n').filter((l) => /^\s*\|/.test(l));
	return rows.slice(2).map(cells);
}

function sections(text) {
	const out = {};
	const parts = text.split(/^## /m).slice(1);
	for (const p of parts) {
		const nl = p.indexOf('\n');
		out[p.slice(0, nl).trim()] = p.slice(nl + 1);
	}
	return out;
}

export function audit(text) {
	const faults = [];
	const plain = text.replace(/<!--[\s\S]*?-->/g, '');
	const holes = PLACEHOLDERS().filter((p) => plain.includes(p));
	if (holes.length) faults.push(`unfilled placeholder(s): ${holes.slice(0, 3).join(', ')}`);
	if (!/^# Improvement report: \S/m.test(text)) faults.push('the title line "# Improvement report: <title>" is missing');
	const head = {};
	for (const l of text.split(/^## /m)[0].split('\n').filter((x) => /^\|/.test(x))) {
		const [k, v] = cells(l);
		if (k && k !== 'Field' && !/^-+$/.test(k)) head[k] = v;
	}
	if (Buffer.byteLength(text) > MAX_BYTES) faults.push(`the report is over ${MAX_BYTES.toLocaleString('en-US')} bytes`);
	for (const f of FIELDS) if (!(f in head) || !head[f]) faults.push(`field "${f}" is missing or empty`);
	for (const [f, v] of Object.entries(head)) if (v.length > MAX_FIELD) faults.push(`field "${f}" is over ${MAX_FIELD} characters`);
	for (const [f, ok] of Object.entries(ONE_OF)) if (head[f] && !ok.includes(head[f])) faults.push(`field "${f}" is "${head[f]}", not one of: ${ok.join(', ')}`);
	if (head.ID && !/^IR-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(head.ID)) faults.push(`field "ID" must look like IR-YYYY-MM-DD-slug, not "${head.ID}"`);
	if (head.Date && !/^\d{4}-\d{2}-\d{2}$/.test(head.Date)) faults.push('field "Date" must be YYYY-MM-DD');
	if (head['Kit version'] && !/^\d+\.\d+\.\d+$/.test(head['Kit version'])) faults.push('field "Kit version" must be x.y.z');
	if (head.Status === 'closed' && !/^\d+\.\d+\.\d+$/.test(head['Closed by'] || '')) faults.push('a closed report names the kit version that closed it in "Closed by"');

	const sec = sections(text);
	for (const s of SECTIONS) if (!sec[s] || !sec[s].replace(/<!--[\s\S]*?-->/g, '').trim()) faults.push(`section "## ${s}" is missing or empty`);
	for (const [s, body] of Object.entries(sec)) if (body.length > MAX_SECTION) faults.push(`section "## ${s}" is over ${MAX_SECTION.toLocaleString('en-US')} characters`);

	const causes = tableUnder(sec['Root causes'] || '');
	if (!causes.length) faults.push('no root causes');
	for (const [n, , evidence, label] of causes) {
		if (!evidence) faults.push(`cause #${n} has no evidence (file:line, a quote, an output or a log line)`);
		if (!['proven', 'guess'].includes((label || '').toLowerCase())) faults.push(`cause #${n}: "Proven or guess" must say proven or guess`);
	}
	const key = (sec['Root causes'] || '').match(/\*\*Key cause:\*\* #(\d+)/);
	if (!key) faults.push('no "**Key cause:** #<n>" line');
	else if (!causes.some((c) => c[0] === key[1])) faults.push(`Key cause #${key[1]} is not in the causes table`);

	const fixes = tableUnder(sec.Fixes || '');
	if (!fixes.length) faults.push('no fixes');
	for (const [n, , where, kind, effect] of fixes) {
		if (!where) faults.push(`fix #${n} does not say where in the kit`);
		if (!KINDS.includes((kind || '').toLowerCase())) faults.push(`fix #${n}: kind "${kind}" is not one of: ${KINDS.join(', ')}`);
		const e = (effect || '').toLowerCase();
		if (!EFFECTS.includes(e)) faults.push(`fix #${n}: standards effect "${effect}" is not same or higher; a change that lowers a standard is a decision for the owner, not a fix`);
	}
	for (const p of ['Guard and control', 'Next real use', 'Lesson']) {
		if (!new RegExp(`\\*\\*${p}:\\*\\* \\S`).test(sec.Proof || '')) faults.push(`proof "${p}" is missing`);
	}
	return faults;
}

function create(title) {
	if (!title || !title.trim()) { console.log('Usage: improvement-report.mjs new "<one-line title>"'); return 2; }
	const cwd = process.cwd();
	const top = git(cwd, 'rev-parse', '--show-toplevel');
	const root = top.status === 0 ? top.stdout.trim() : cwd;
	let version = '<x.y.z>';
	try { version = JSON.parse(fs.readFileSync(path.join(root, '.kit', 'kit-version.json'), 'utf8')).version || version; } catch { /* no stamp */ }
	const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() || '<branch>';
	const commit = git(root, 'rev-parse', '--short', 'HEAD').stdout.trim() || '<short commit>';
	const id = `IR-${today()}-${slug(title)}`;
	const text = fs.readFileSync(TEMPLATE, 'utf8')
		.replace('<one-line title>', () => title.trim())
		.replace('<IR-YYYY-MM-DD-slug>', () => id)
		.replace('| <YYYY-MM-DD> |', `| ${today()} |`)
		.replace('<project folder name>', () => path.basename(root))
		.replace('<branch> @ <short commit>', () => `${branch} @ ${commit}`)
		.replace('| <x.y.z> |', () => `| ${version} |`)
		.replace('<the kit version that closes it; leave "-" while open>', () => '-');
	const dir = path.join(root, '.kit', 'reports');
	const file = path.join(dir, `${id}.md`);
	if (fs.existsSync(file)) { console.log(`${file} already exists; pick another title.`); return 1; }
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, text);
	console.log(`Started ${file}. Fill it in, then run: node .claude/improvement-report.mjs audit "${file}"`);
	return 0;
}

function list() {
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	const dir = path.join(top.status === 0 ? top.stdout.trim() : process.cwd(), '.kit', 'reports');
	const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^IR-.*\.md$/.test(f)).sort() : [];
	for (const f of files) {
		const s = (fs.readFileSync(path.join(dir, f), 'utf8').match(/^\| Status \| (\S+) \|/m) || [])[1] || '?';
		console.log(`${s.padEnd(9)} ${f}`);
	}
	if (!files.length) console.log('No improvement reports in .kit/reports/.');
	return 0;
}

// Hand a report to the kit: the kit's intake script signs it with this project's key into the kit inbox and starts
// the inbox run. Nothing else in the kit is written, and the local copy is marked filed.
function fileReport(arg) {
	const text = fs.readFileSync(arg, 'utf8');
	const faults = audit(text);
	if (faults.length) { console.log(`FAIL ${path.basename(arg)}: fix it before filing`); for (const f of faults) console.log(`    ${f}`); return 1; }
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	const root = top.status === 0 ? top.stdout.trim() : process.cwd();
	let kitDir = null;
	try { kitDir = JSON.parse(fs.readFileSync(path.join(root, '.kit', 'kit-version.json'), 'utf8')).kitDir; } catch { /* no stamp */ }
	const intake = kitDir && path.join(kitDir, 'scripts', 'intake.mjs');
	if (!intake || !fs.existsSync(intake)) { console.log('The kit folder this project was installed from is not found (.kit/kit-version.json kitDir); nothing filed.'); return 1; }
	const r = spawnSync(process.execPath, [intake, 'file', path.resolve(arg)], { cwd: root, encoding: 'utf8' });
	process.stdout.write(r.stdout || '');
	if (r.status !== 0) return 1;
	fs.writeFileSync(arg, text.replace(/^\| Status \| open \|$/m, '| Status | filed |'));
	return 0;
}

function main(argv) {
	const [cmd, arg] = argv;
	if (cmd === 'new') return create(argv.slice(1).join(' '));
	if (cmd === 'list') return list();
	if (cmd === 'file' && arg) return fileReport(arg);
	if (cmd === 'audit' && arg) {
		const faults = audit(fs.readFileSync(arg, 'utf8'));
		if (!faults.length) { console.log(`PASS ${path.basename(arg)}`); return 0; }
		console.log(`FAIL ${path.basename(arg)}`);
		for (const f of faults) console.log(`    ${f}`);
		return 1;
	}
	console.log('Usage: improvement-report.mjs new "<title>" | audit <report.md> | list | file <report.md>');
	return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
